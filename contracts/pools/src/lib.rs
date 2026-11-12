//! Radar Pools: a minimal prediction market on NEAR, built for testnet.
//!
//! Each market asks one question with 2 or 3 outcomes ("BTC above $100k on Dec 31?"
//! YES / NO, or "Arsenal vs Chelsea": Arsenal / Draw / Chelsea). Bets go into one pool
//! per outcome (pari-mutuel): when the market is resolved, everyone who backed the
//! winning outcome shares the whole pot in proportion to their stake. No order book,
//! no market maker. The current "price" of an outcome is its share of the pot.
//!
//! Money comes in as a NEP-141 token through `ft_transfer_call` with
//! `{"owner": "..."}` in `msg` and is held as an internal balance for that owner. On
//! mainnet this is exactly how a NEAR Intents swap would deposit; on testnet a test
//! dollar (tUSD) stands in.
//!
//! An owner is either a NEAR account (acting directly) or an ed25519 public key
//! ("ed25519:..."), so people without a wallet can play: their browser holds the key
//! and signs each bet; anyone (a relayer) can submit the signed bet and pay the gas.
//! Every signature carries a per-owner nonce, so it works only once.
//!
//! Results are posted by a named operator (the resolver), with the source it used.
//! This is trusted by design for the hackathon; a market can also be cancelled, and
//! a winning outcome nobody backed cancels it, so every stake is refunded.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{assert_one_yocto, env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};

const MAX_TITLE: usize = 140;
const MAX_NOTE: usize = 280;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MarketStatus {
    Open,
    Resolved,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Market {
    pub id: U64,
    pub title: String,
    /// "crypto", "football", ...
    pub category: String,
    pub outcomes: Vec<String>,
    /// Betting stops at this time (ns); results can be posted from then on.
    pub closes_at: U64,
    pub status: MarketStatus,
    /// Total staked on each outcome.
    pub pools: Vec<U128>,
    pub bettors: u32,
    pub winner: Option<u8>,
    /// What decided it, e.g. "Pyth BTC/USD at 2026-12-31 23:59 UTC: $101,240".
    pub resolution: Option<String>,
    pub source: Option<String>,
    pub created_at: U64,
    pub resolved_at: Option<U64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Position {
    /// Stake on each outcome.
    pub stakes: Vec<U128>,
    pub claimed: bool,
}

/// What an owner key can sign.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    Bet { market_id: U64, outcome: u8, amount: U128 },
}

/// The `msg` of an `ft_transfer_call` that funds an owner's balance.
#[derive(Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct DepositMsg {
    pub owner: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    /// Creates markets and posts results.
    operator: AccountId,
    /// The only token accepted.
    token: AccountId,
    markets: IterableMap<u64, Market>,
    next_id: u64,
    /// "{market_id}|{owner}" -> position
    positions: LookupMap<String, Position>,
    balances: LookupMap<String, u128>,
    nonces: LookupMap<String, u32>,
    /// owner -> markets they bet on
    owner_markets: LookupMap<String, Vec<u64>>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, operator: AccountId, token: AccountId) -> Self {
        Self {
            owner,
            operator,
            token,
            markets: IterableMap::new(b"m"),
            next_id: 1,
            positions: LookupMap::new(b"p"),
            balances: LookupMap::new(b"b"),
            nonces: LookupMap::new(b"n"),
            owner_markets: LookupMap::new(b"o"),
        }
    }

    // ---------------------------------------------------------------- operator

    pub fn create_market(&mut self, title: String, category: String, outcomes: Vec<String>, closes_at: U64) -> U64 {
        self.assert_operator();
        let title = title.trim().to_string();
        require!(!title.is_empty() && title.len() <= MAX_TITLE, "Title must be 1-140 characters");
        require!((2..=3).contains(&outcomes.len()), "A market has 2 or 3 outcomes");
        require!(outcomes.iter().all(|o| !o.trim().is_empty() && o.len() <= 40), "Outcome names must be 1-40 characters");
        require!(closes_at.0 > env::block_timestamp(), "Closing time must be in the future");
        let category = category.trim().to_lowercase();
        if category == "flash" {
            // Quick rounds are opened on demand by the relay; one round per closing time.
            require!(
                !self.markets.values().any(|m| m.category == "flash" && m.status == MarketStatus::Open && m.closes_at == closes_at),
                "A round for this closing time already exists"
            );
        }
        let id = self.next_id;
        self.next_id += 1;
        let n = outcomes.len();
        self.markets.insert(
            id,
            Market {
                id: U64(id),
                title,
                category,
                outcomes: outcomes.into_iter().map(|o| o.trim().to_string()).collect(),
                closes_at,
                status: MarketStatus::Open,
                pools: vec![U128(0); n],
                bettors: 0,
                winner: None,
                resolution: None,
                source: None,
                created_at: U64(env::block_timestamp()),
                resolved_at: None,
            },
        );
        env::log_str(&format!("market_created id={id}"));
        U64(id)
    }

    /// Post the result. A winning outcome nobody backed cancels the market (everyone is refunded).
    pub fn resolve(&mut self, market_id: U64, winner: u8, resolution: String, source: Option<String>) {
        self.assert_operator();
        let mut m = self.market(market_id);
        require!(m.status == MarketStatus::Open, "Market is already settled");
        require!(env::block_timestamp() >= m.closes_at.0, "Market is still open for bets");
        require!((winner as usize) < m.outcomes.len(), "No such outcome");
        require!(resolution.len() <= MAX_NOTE, "Resolution note is too long");
        m.resolution = Some(resolution);
        m.source = source;
        m.resolved_at = Some(U64(env::block_timestamp()));
        m.winner = Some(winner);
        m.status = if m.pools[winner as usize].0 == 0 { MarketStatus::Cancelled } else { MarketStatus::Resolved };
        env::log_str(&format!("market_settled id={} winner={winner} status={:?}", m.id.0, m.status));
        self.markets.insert(m.id.0, m);
    }

    /// Cancel a market: every stake can be claimed back in full.
    pub fn cancel(&mut self, market_id: U64, reason: String) {
        self.assert_operator();
        let mut m = self.market(market_id);
        require!(m.status == MarketStatus::Open, "Market is already settled");
        require!(reason.len() <= MAX_NOTE, "Reason is too long");
        m.status = MarketStatus::Cancelled;
        m.resolution = Some(reason);
        m.resolved_at = Some(U64(env::block_timestamp()));
        self.markets.insert(m.id.0, m);
    }

    // ---------------------------------------------------------------- money in and out

    /// Deposits: `msg` = {"owner": "<account id or ed25519 key>"}. Everything is credited.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let _ = sender_id;
        if env::predecessor_account_id() != self.token {
            return PromiseOrValue::Value(amount);
        }
        let Ok(deposit) = near_sdk::serde_json::from_str::<DepositMsg>(&msg) else {
            return PromiseOrValue::Value(amount);
        };
        if !valid_owner(&deposit.owner) {
            return PromiseOrValue::Value(amount);
        }
        let bal = self.balance_of(&deposit.owner) + amount.0;
        self.balances.insert(deposit.owner.clone(), bal);
        env::log_str(&format!("deposit owner={} amount={}", deposit.owner, amount.0));
        PromiseOrValue::Value(U128(0))
    }

    /// A NEAR account withdraws its own balance. Requires 1 yoctoNEAR (full-access key).
    #[payable]
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        assert_one_yocto();
        let who = env::predecessor_account_id();
        let bal = self.balance_of(who.as_str());
        require!(amount.0 > 0 && amount.0 <= bal, "Not enough balance");
        self.balances.insert(who.to_string(), bal - amount.0);
        Promise::new(self.token.clone())
            .function_call(
                "ft_transfer".to_string(),
                near_sdk::serde_json::json!({ "receiver_id": who, "amount": amount }).to_string().into_bytes(),
                NearToken::from_yoctonear(1),
                Gas::from_tgas(10),
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "on_withdraw".to_string(),
                near_sdk::serde_json::json!({ "owner": who, "amount": amount }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(5),
            ))
    }

    /// A failed withdrawal (e.g. the account isn't registered with the token) is credited back.
    #[private]
    pub fn on_withdraw(&mut self, owner: AccountId, amount: U128) {
        if env::promise_result_checked(0, 100).is_err() {
            let bal = self.balance_of(owner.as_str()) + amount.0;
            self.balances.insert(owner.to_string(), bal);
            env::log_str(&format!("withdraw_failed owner={owner} amount={} restored", amount.0));
        }
    }

    // ---------------------------------------------------------------- betting

    /// A NEAR account bets from its own balance.
    pub fn bet(&mut self, market_id: U64, outcome: u8, amount: U128) {
        let who = env::predecessor_account_id().to_string();
        self.internal_bet(&who, market_id, outcome, amount);
    }

    /// A key owner's signed bet, submitted by anyone (who pays the gas).
    pub fn bet_signed(&mut self, owner: String, action: Action, signature: String) {
        require!(owner.starts_with("ed25519:"), "Signed bets are for key owners");
        let message = self.message_for(&owner, &action);
        require!(verify_ed25519(&owner, &signature, message.as_bytes()), "Invalid signature");
        let nonce = self.nonces.get(&owner).copied().unwrap_or(0);
        self.nonces.insert(owner.clone(), nonce + 1);
        match action {
            Action::Bet { market_id, outcome, amount } => self.internal_bet(&owner, market_id, outcome, amount),
        }
    }

    /// Pay out a settled market's position into the owner's balance. Anyone can call it:
    /// the money only ever goes to the position's owner.
    pub fn claim(&mut self, market_id: U64, owner: String) -> U128 {
        let m = self.market(market_id);
        require!(m.status != MarketStatus::Open, "Market is not settled yet");
        let key = pos_key(market_id.0, &owner);
        let Some(mut pos) = self.positions.get(&key).cloned() else { env::panic_str("No position") };
        require!(!pos.claimed, "Already claimed");
        let payout = Self::payout(&m, &pos);
        pos.claimed = true;
        self.positions.insert(key, pos);
        if payout > 0 {
            let bal = self.balance_of(&owner) + payout;
            self.balances.insert(owner.clone(), bal);
        }
        env::log_str(&format!("claim market={} owner={owner} payout={payout}", market_id.0));
        U128(payout)
    }

    // ---------------------------------------------------------------- views

    pub fn get_markets(&self, from: Option<u32>, limit: Option<u32>) -> Vec<Market> {
        self.markets
            .values()
            .skip(from.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .cloned()
            .collect()
    }

    /// Every market still open for bets or waiting for its result, oldest first.
    pub fn get_open_markets(&self) -> Vec<Market> {
        self.markets.values().filter(|m| m.status == MarketStatus::Open).cloned().collect()
    }

    /// The newest markets first (ids are consecutive), e.g. the latest quick rounds.
    pub fn get_recent_markets(&self, limit: Option<u32>) -> Vec<Market> {
        let n = limit.unwrap_or(20).min(100) as u64;
        (1..self.next_id).rev().take(n as usize).filter_map(|id| self.markets.get(&id).cloned()).collect()
    }

    pub fn get_market_count(&self) -> u64 {
        self.next_id - 1
    }

    pub fn get_market(&self, market_id: U64) -> Option<Market> {
        self.markets.get(&market_id.0).cloned()
    }

    pub fn get_position(&self, market_id: U64, owner: String) -> Option<Position> {
        self.positions.get(&pos_key(market_id.0, &owner)).cloned()
    }

    /// What a position would pay if `outcome` won now (with the pools as they stand).
    pub fn payout_if(&self, market_id: U64, owner: String, outcome: u8) -> U128 {
        let mut m = self.market(market_id);
        let Some(pos) = self.positions.get(&pos_key(market_id.0, &owner)) else { return U128(0) };
        m.status = MarketStatus::Resolved;
        m.winner = Some(outcome);
        U128(if m.pools[outcome as usize].0 == 0 { 0 } else { Self::payout(&m, pos) })
    }

    pub fn get_balance(&self, owner: String) -> U128 {
        U128(self.balance_of(&owner))
    }

    pub fn get_owner_markets(&self, owner: String) -> Vec<u64> {
        self.owner_markets.get(&owner).cloned().unwrap_or_default()
    }

    pub fn get_nonce(&self, owner: String) -> u32 {
        self.nonces.get(&owner).copied().unwrap_or(0)
    }

    /// The exact text a key owner signs for `action` right now.
    pub fn action_message(&self, owner: String, action: Action) -> String {
        self.message_for(&owner, &action)
    }

    pub fn get_config(&self) -> (AccountId, AccountId, AccountId) {
        (self.owner.clone(), self.operator.clone(), self.token.clone())
    }

    // ---------------------------------------------------------------- internals

    fn internal_bet(&mut self, owner: &str, market_id: U64, outcome: u8, amount: U128) {
        let mut m = self.market(market_id);
        require!(m.status == MarketStatus::Open, "Market is closed");
        require!(env::block_timestamp() < m.closes_at.0, "Betting has closed");
        require!((outcome as usize) < m.outcomes.len(), "No such outcome");
        require!(amount.0 > 0, "Amount must be positive");
        let bal = self.balance_of(owner);
        require!(amount.0 <= bal, "Not enough balance");
        self.balances.insert(owner.to_string(), bal - amount.0);

        let key = pos_key(market_id.0, owner);
        let mut pos = self.positions.get(&key).cloned().unwrap_or_default();
        if pos.stakes.is_empty() {
            pos.stakes = vec![U128(0); m.outcomes.len()];
            m.bettors += 1;
            let mut list = self.owner_markets.get(owner).cloned().unwrap_or_default();
            list.push(market_id.0);
            self.owner_markets.insert(owner.to_string(), list);
        }
        pos.stakes[outcome as usize] = U128(pos.stakes[outcome as usize].0 + amount.0);
        m.pools[outcome as usize] = U128(m.pools[outcome as usize].0 + amount.0);
        self.positions.insert(key, pos);
        env::log_str(&format!("bet market={} owner={owner} outcome={outcome} amount={}", market_id.0, amount.0));
        self.markets.insert(market_id.0, m);
    }

    /// Resolved: winning stake x whole pot / winning pool. Cancelled: every stake back.
    fn payout(m: &Market, pos: &Position) -> u128 {
        match m.status {
            MarketStatus::Cancelled => pos.stakes.iter().map(|s| s.0).sum(),
            MarketStatus::Resolved => {
                let w = m.winner.unwrap_or(0) as usize;
                let total: u128 = m.pools.iter().map(|p| p.0).sum();
                let win_pool = m.pools[w].0;
                if win_pool == 0 { 0 } else { pos.stakes[w].0 * total / win_pool }
            }
            MarketStatus::Open => 0,
        }
    }

    fn message_for(&self, owner: &str, action: &Action) -> String {
        let nonce = self.nonces.get(owner).copied().unwrap_or(0);
        format!(
            "{}|radar-pools|{}|nonce:{}|{}",
            env::current_account_id(),
            owner,
            nonce,
            near_sdk::serde_json::to_string(action).unwrap()
        )
    }

    fn market(&self, id: U64) -> Market {
        self.markets.get(&id.0).cloned().unwrap_or_else(|| env::panic_str("Market not found"))
    }

    fn balance_of(&self, owner: &str) -> u128 {
        self.balances.get(owner).copied().unwrap_or(0)
    }

    fn assert_operator(&self) {
        require!(env::predecessor_account_id() == self.operator, "Only the operator");
    }
}

fn pos_key(market_id: u64, owner: &str) -> String {
    format!("{market_id}|{owner}")
}

fn parse_key(key: &str) -> Option<[u8; 32]> {
    let bytes = near_sdk::bs58::decode(key.strip_prefix("ed25519:")?).into_vec().ok()?;
    bytes.try_into().ok()
}

/// An owner is a NEAR account id or an ed25519 public key.
fn valid_owner(owner: &str) -> bool {
    if owner.starts_with("ed25519:") {
        parse_key(owner).is_some()
    } else {
        owner.parse::<AccountId>().is_ok()
    }
}

fn verify_ed25519(owner: &str, signature_b58: &str, message: &[u8]) -> bool {
    let Some(pk) = parse_key(owner) else { return false };
    let Ok(sig) = near_sdk::bs58::decode(signature_b58.strip_prefix("ed25519:").unwrap_or(signature_b58)).into_vec() else {
        return false;
    };
    let Ok(sig): Result<[u8; 64], _> = sig.try_into() else { return false };
    env::ed25519_verify(&sig, message, &pk)
}

#[cfg(test)]
mod tests;
