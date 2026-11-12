use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;

const MIN: u64 = 60 * 1_000_000_000;
const TOKEN: &str = "tusd.near";
const D: u128 = 1_000_000; // $1 (6 decimals)

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, now: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("pools.near"))
        .predecessor_account_id(acc(predecessor))
        .block_timestamp(now)
        .build());
}

struct Player {
    key: SigningKey,
}

impl Player {
    fn new() -> Self {
        Self { key: SigningKey::generate(&mut rand::rngs::OsRng) }
    }
    fn id(&self) -> String {
        format!("ed25519:{}", near_sdk::bs58::encode(self.key.verifying_key().to_bytes()).into_string())
    }
    fn sign(&self, c: &Contract, action: &Action) -> String {
        let msg = c.action_message(self.id(), action.clone());
        near_sdk::bs58::encode(self.key.sign(msg.as_bytes()).to_bytes()).into_string()
    }
}

/// A 3-outcome football market closing at minute 10, and a YES/NO crypto market.
fn setup() -> Contract {
    ctx("owner.near", 0);
    let mut c = Contract::new(acc("owner.near"), acc("ops.near"), acc(TOKEN));
    ctx("ops.near", 0);
    c.create_market("Arsenal vs Chelsea".into(), "Football".into(), vec!["Arsenal".into(), "Draw".into(), "Chelsea".into()], U64(10 * MIN));
    c.create_market("Will BTC be above $100,000 at close?".into(), "crypto".into(), vec!["Yes".into(), "No".into()], U64(10 * MIN));
    c
}

fn fund(c: &mut Contract, owner: &str, dollars: u128) {
    ctx(TOKEN, MIN);
    let msg = near_sdk::serde_json::json!({ "owner": owner }).to_string();
    match c.ft_on_transfer(acc("relayer.near"), U128(dollars * D), msg) {
        PromiseOrValue::Value(v) => assert_eq!(v.0, 0, "deposit fully accepted"),
        _ => panic!("expected value"),
    }
}

fn bet(c: &mut Contract, p: &Player, market: u64, outcome: u8, dollars: u128, now: u64) {
    let action = Action::Bet { market_id: U64(market), outcome, amount: U128(dollars * D) };
    let sig = p.sign(c, &action);
    ctx("relayer.near", now);
    c.bet_signed(p.id(), action, sig);
}

#[test]
fn deposit_credits_owner_and_rejects_other_tokens() {
    let mut c = setup();
    let p = Player::new();
    fund(&mut c, &p.id(), 100);
    assert_eq!(c.get_balance(p.id()).0, 100 * D);
    // Not the configured token: everything bounces.
    ctx("fake.near", MIN);
    let msg = near_sdk::serde_json::json!({ "owner": p.id() }).to_string();
    assert!(matches!(c.ft_on_transfer(acc("x.near"), U128(5 * D), msg), PromiseOrValue::Value(v) if v.0 == 5 * D));
    // Garbage owner: bounces.
    ctx(TOKEN, MIN);
    assert!(matches!(c.ft_on_transfer(acc("x.near"), U128(5 * D), r#"{"owner":"ed25519:nope"}"#.into()), PromiseOrValue::Value(v) if v.0 == 5 * D));
    assert_eq!(c.get_balance(p.id()).0, 100 * D);
}

#[test]
fn three_outcome_pool_pays_winners_pro_rata() {
    let mut c = setup();
    let (ada, ben, cy) = (Player::new(), Player::new(), Player::new());
    for p in [&ada, &ben, &cy] {
        fund(&mut c, &p.id(), 100);
    }
    bet(&mut c, &ada, 1, 0, 30, 2 * MIN); // Arsenal $30
    bet(&mut c, &ben, 1, 0, 10, 2 * MIN); // Arsenal $10
    bet(&mut c, &cy, 1, 2, 60, 3 * MIN); // Chelsea $60
    let m = c.get_market(U64(1)).unwrap();
    assert_eq!(m.pools.iter().map(|p| p.0).sum::<u128>(), 100 * D);
    assert_eq!(m.bettors, 3);
    // If Arsenal won now, Ada (30 of the 40 on Arsenal) would get 75 of the 100 pot.
    assert_eq!(c.payout_if(U64(1), ada.id(), 0).0, 75 * D);

    ctx("ops.near", 10 * MIN);
    c.resolve(U64(1), 0, "Full time: Arsenal 2-1 Chelsea".into(), Some("https://www.premierleague.com".into()));
    assert_eq!(c.get_market(U64(1)).unwrap().status, MarketStatus::Resolved);
    ctx("anyone.near", 11 * MIN);
    assert_eq!(c.claim(U64(1), ada.id()).0, 75 * D);
    assert_eq!(c.claim(U64(1), ben.id()).0, 25 * D);
    assert_eq!(c.claim(U64(1), cy.id()).0, 0);
    assert_eq!(c.get_balance(ada.id()).0, 145 * D);
    assert_eq!(c.get_balance(ben.id()).0, 115 * D);
    assert_eq!(c.get_balance(cy.id()).0, 40 * D);
}

#[test]
#[should_panic(expected = "Already claimed")]
fn claim_only_once() {
    let mut c = setup();
    let p = Player::new();
    fund(&mut c, &p.id(), 10);
    bet(&mut c, &p, 2, 0, 10, MIN);
    ctx("ops.near", 10 * MIN);
    c.resolve(U64(2), 0, "BTC $101,000".into(), None);
    ctx("anyone.near", 11 * MIN);
    c.claim(U64(2), p.id());
    c.claim(U64(2), p.id());
}

#[test]
fn winner_nobody_backed_cancels_and_refunds() {
    let mut c = setup();
    let p = Player::new();
    fund(&mut c, &p.id(), 20);
    bet(&mut c, &p, 1, 0, 20, MIN);
    ctx("ops.near", 10 * MIN);
    c.resolve(U64(1), 1, "Full time: 1-1".into(), None); // Draw, nobody on it
    assert_eq!(c.get_market(U64(1)).unwrap().status, MarketStatus::Cancelled);
    ctx("anyone.near", 11 * MIN);
    assert_eq!(c.claim(U64(1), p.id()).0, 20 * D);
}

#[test]
fn cancel_refunds_every_stake() {
    let mut c = setup();
    let p = Player::new();
    fund(&mut c, &p.id(), 50);
    bet(&mut c, &p, 1, 0, 20, MIN);
    bet(&mut c, &p, 1, 2, 30, MIN);
    ctx("ops.near", 2 * MIN);
    c.cancel(U64(1), "Match postponed".into());
    ctx("anyone.near", 3 * MIN);
    assert_eq!(c.claim(U64(1), p.id()).0, 50 * D);
}

#[test]
#[should_panic(expected = "Invalid signature")]
fn signature_works_only_once() {
    let mut c = setup();
    let p = Player::new();
    fund(&mut c, &p.id(), 50);
    let action = Action::Bet { market_id: U64(2), outcome: 0, amount: U128(5 * D) };
    let sig = p.sign(&c, &action);
    ctx("relayer.near", MIN);
    c.bet_signed(p.id(), action.clone(), sig.clone());
    c.bet_signed(p.id(), action, sig); // replay
}

#[test]
#[should_panic(expected = "Invalid signature")]
fn cannot_bet_someone_elses_money() {
    let mut c = setup();
    let (victim, thief) = (Player::new(), Player::new());
    fund(&mut c, &victim.id(), 50);
    let action = Action::Bet { market_id: U64(2), outcome: 0, amount: U128(50 * D) };
    let sig = thief.sign(&c, &action);
    ctx("relayer.near", MIN);
    c.bet_signed(victim.id(), action, sig);
}

#[test]
#[should_panic(expected = "Betting has closed")]
fn no_bets_after_close() {
    let mut c = setup();
    let p = Player::new();
    fund(&mut c, &p.id(), 10);
    bet(&mut c, &p, 2, 0, 5, 10 * MIN);
}

#[test]
#[should_panic(expected = "Not enough balance")]
fn cannot_bet_more_than_balance() {
    let mut c = setup();
    let p = Player::new();
    fund(&mut c, &p.id(), 10);
    bet(&mut c, &p, 2, 0, 11, MIN);
}

#[test]
#[should_panic(expected = "Market is still open for bets")]
fn no_result_before_close() {
    let mut c = setup();
    ctx("ops.near", 5 * MIN);
    c.resolve(U64(2), 0, "too early".into(), None);
}

#[test]
#[should_panic(expected = "Only the operator")]
fn only_operator_resolves() {
    let mut c = setup();
    ctx("mallory.near", 20 * MIN);
    c.resolve(U64(2), 0, "I win".into(), None);
}

#[test]
#[should_panic(expected = "A market has 2 or 3 outcomes")]
fn markets_have_two_or_three_outcomes() {
    let mut c = setup();
    ctx("ops.near", 0);
    c.create_market("x".into(), "crypto".into(), vec!["a".into(), "b".into(), "c".into(), "d".into()], U64(MIN));
}

#[test]
fn near_accounts_bet_directly_and_positions_are_listed() {
    let mut c = setup();
    fund(&mut c, "alice.near", 40);
    ctx("alice.near", MIN);
    c.bet(U64(2), 1, U128(15 * D));
    assert_eq!(c.get_balance("alice.near".into()).0, 25 * D);
    assert_eq!(c.get_owner_markets("alice.near".into()), vec![2]);
    assert!(get_logs().iter().any(|l| l.contains("bet market=2 owner=alice.near outcome=1")));
}

#[test]
fn open_and_recent_views() {
    let mut c = setup();
    ctx("ops.near", 10 * MIN);
    c.resolve(U64(2), 0, "BTC $101,000".into(), None);
    assert_eq!(c.get_open_markets().iter().map(|m| m.id.0).collect::<Vec<_>>(), vec![1]);
    assert_eq!(c.get_recent_markets(Some(1))[0].id.0, 2);
    assert_eq!(c.get_market_count(), 2);
}

#[test]
#[should_panic(expected = "A round for this closing time already exists")]
fn one_quick_round_per_closing_time() {
    let mut c = setup();
    ctx("ops.near", 0);
    c.create_market("Bitcoin in 2 minutes: above $1".into(), "flash".into(), vec!["Higher".into(), "Not higher".into()], U64(3 * MIN));
    c.create_market("Bitcoin in 2 minutes: above $2".into(), "flash".into(), vec!["Higher".into(), "Not higher".into()], U64(3 * MIN));
}
