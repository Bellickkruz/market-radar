# Market Radar 🛰️

**Market Radar is a prediction market aggregator.** Type the market you're looking for and it searches Polymarket, Kalshi, Limitless and Manifold at once, so you don't have to visit each one to find who lists it. **Find the best odds on any prediction market. Fund it from any coin, through NEAR Intents. And when you want to try one on NEAR itself, Radar Pools is our own prediction market contract on NEAR testnet.**

- **Live app (NEAR HACKATHON entry):** https://market-radar-taupe.vercel.app (Radar Pools: switch the header to **Testnet**, or https://market-radar-taupe.vercel.app/?net=testnet)
- **What was built for NEAR HACKATHON:** the `web/` app, compared with the pre-hackathon baseline in [`pre-hackathon...main`](https://github.com/Bellickkruz/market-radar/compare/pre-hackathon...main) (see [Disclosure](#disclosure))
- **Radar Pools contract (NEAR testnet):** [`pools.mradar-mwcw3x85.testnet`](https://testnet.nearblocks.io/address/pools.mradar-mwcw3x85.testnet)
- **Tracks:** `defi` (a prediction market on NEAR, plus cross-chain settlement through NEAR Intents), `realworld` (stablecoin payments for consumers)
- **Other project by the same author:** [PayPact](https://github.com/Bellickkruz/paypact), escrowed invoice links on NEAR. The two projects share no code.

## The problem

The same question ("Will Bitcoin reach $100k by the end of 2026?") trades on several prediction markets at different prices: in a live check on 2026-11-12, YES cost 9¢ on Kalshi and 5.5¢ on Polymarket. Finding the cheapest venue means searching each one separately. Using it is worse, because every venue takes money on a different chain: Polymarket wants USDC on Polygon, Limitless wants USDC on Base, and Kalshi takes USDC on networks such as Solana or Base. Someone holding NEAR, ETH, SOL or BTC first has to bridge and swap their way there.

## What Market Radar on NEAR does

1. **One search across 4 venues.** Type a hunch in plain words. Market Radar searches Polymarket, Kalshi, Limitless and Manifold at once and ranks the results by how well they match, how much they trade and how trustworthy the venue is.
2. **Same question, compared.** When several venues list the same question, it puts them side by side, marks the cheapest YES and NO among real-money venues, and shows the price gap. Two markets count as the same question only when their price levels ($149,999.99 counts as $150k), years, direction ("hit" is not "dip to") and subject words agree.
3. **Fund it from any coin.** Tap a price, choose a stake, and paste your own deposit address from that venue. Market Radar asks NEAR Intents (1Click API) for a quote that delivers exactly that many dollars of USDC to that address on the venue's chain. You pay with NEAR, USDC on NEAR, ETH, SOL, BTC, USDT or USDC from another chain. Live prices for every coin are shown before you choose, and the deposit address, amount and QR code after.

Market Radar never holds money. The NEAR Intents deposit address forwards your coin, swapped to USDC, straight to your own venue account. If the swap can't complete, it refunds to an address you give.

4. **Radar Pools: a prediction market on NEAR (testnet).** Flip the header switch from **Mainnet** to **Testnet** and Market Radar becomes a small prediction market of our own, running as a Rust smart contract on NEAR. It offers crypto price questions (BTC, ETH, SOL), football with three outcomes (home / draw / away), and a **Bitcoin round that opens and settles every 2 minutes**. It uses pool betting: each outcome has a pool, its share of the pot is its price, and the winners split the whole pot by stake. Players need no wallet: the browser holds a key that signs each bet, and a relay pays the gas. When a mainnet search matches one of our pools, a "Radar Pools · NEAR · testnet only" card appears in the results. **Real-money betting needs licences, so Radar Pools runs on testnet only**, with free test dollars.

## Try it (no wallet needed to see everything up to payment)

| # | Do | See |
|---|----|-----|
| 0 | Open https://market-radar-taupe.vercel.app. | The home page is a live market screen. A 3D radar sweeps over Polymarket, Kalshi, Limitless, Manifold and Radar Pools. The **Price gaps right now** board lists popular questions with each venue's YES price, the cheapest highlighted and the gap in cents; prices flash when they change. **Fund any venue from** shows what $100 of USDC in a Polymarket account costs right now in NEAR, ETH, SOL, BTC and USDC (live NEAR Intents quotes). **Radar Pools** shows our NEAR testnet markets and the Bitcoin round countdown. |
| 1 | On the board, tap **Fund cheapest** on the Bitcoin $100k row, or search `bitcoin 100k`. | Results from Polymarket, Kalshi, Limitless and Manifold in about 2 s. A **📡 Same question on 3 venues** card shows Kalshi, Polymarket and Manifold side by side, with *cheapest* labels and the price gap in cents. |
| 2 | Tap the YES price marked **cheapest** (with **Fund cheapest**, it's already selected). | A 4-step funding panel opens. Step 1 shows how many shares $50 buys and what they pay if YES wins. |
| 3 | Step 2: paste any valid address for the network shown (for testing, `0x52908400098527886E0F7030069857D2E4169EE7`) and tick the box. | The box can't be ticked until the address fits the network. Step 3 shows **live NEAR Intents prices** for delivering exactly $50 of USDC there, paid in 10 different coins (for example "0.0246 ETH", "14.05 NEAR"). Routes with a current minimum say so ("min $100"). |
| 4 | Step 3: pick **ETH on Ethereum**. Step 4: paste an Ethereum address for refunds. Tap **Get payment details**. | A real NEAR Intents deposit address with a QR code, the exact ETH to send, and "about 51 seconds later, $50 USDC arrives in your Polymarket account on Polygon". Status updates on its own every 6 s. **Nothing is sent unless you send it.** |
| 5 | Try `Arsenal`, `Nigeria election 2027` or `Fed rate cut`. | Sports and elections are matched across venues too. When no venue lists the same question, no comparison is shown rather than a wrong one. |
| 6 | Search `bitcoin 100k` or `Chelsea vs Leeds`. | Besides the venues, a **Radar Pools · NEAR · testnet only** card shows the same question on our own NEAR contract, with each outcome's share of the pot. Tap **Try it on testnet →**. |
| 7 | In **Testnet** mode (header switch), tap **Get $100 test dollars**. | Your balance shows $100 after about 5 s. It's held for your browser's key in the contract (`get_balance`). |
| 8 | On **Liverpool vs Manchester United**, tap **Draw**, pick **$10** and **Bet $10 on Draw**. | The pot grows by $10, the percentages move, and the card shows *you: $10*. |
| 9 | On the **⚡ Quick round** ("Bitcoin in 2 minutes: above $73,577.33 at 01:57 UTC?"), bet on **Higher** or **Not higher**, then wait for the countdown. | About 30–60 s after it closes, the round settles from Coinbase's public 1-minute BTC-USD price: "Coinbase BTC-USD price at 01:57 UTC: $73,571.23 (not above $73,577.33)", with a source link. Winnings are paid into your balance automatically and a new round opens. |

Prediction markets are not legal everywhere. Check before funding a venue.

## How it works

```
 browser ──► /api/scout (Vercel) ──► Polymarket · Kalshi · Limitless · Manifold public APIs
    │            same matching and ranking as the Market Radar PayBox plugin (api/_venues.ts = src/venues.ts)
    │            + "same question" grouping (api/scout.ts)
    │
    └──► NEAR Intents 1Click API (https://1click.chaindefuser.com/v0)
            /quote  dry: live prices for 10 coins (no deposit address, nothing can be sent)
            /quote  real: EXACT_OUTPUT, destination = USDC on the venue's chain,
                    recipient = the user's own venue deposit address, refundTo = user's origin address
            /status polled every 6 s until SUCCESS / REFUNDED
```

**Destinations** (`web/src/lib/intents.ts`). Sources were checked on 2026-11-12. Venues change their deposit options, so the user confirms against their own deposit screen before any payment details are shown.

| Venue | USDC delivered on | NEAR Intents asset |
|---|---|---|
| Polymarket | Polygon (native USDC `0x3c49…3359`) | `nep141:pol-0x3c49…3359.omdep.near` |
| Limitless | Base (native USDC `0x8335…2913`) | `nep141:base-0x8335…2913.omft.near` |
| Kalshi | the network the user picks on Kalshi's deposit screen: Solana, Base, Ethereum, Polygon or Arbitrum | matching `nep141:…` USDC asset |
| Manifold | not funded (play money, shown as a crowd signal only) | |

**Radar Pools** (`contracts/pools`, Rust, near-sdk 5; 15 unit tests)
- **Markets** have 2 or 3 outcomes, a closing time, one pool per outcome and a status (`Open`, `Resolved` or `Cancelled`).
- **Money in:** NEP-141 `ft_transfer_call` with `{"owner": ...}` credits an internal balance. On mainnet this is exactly how a NEAR Intents swap would deposit; on testnet a test dollar (`tusd.mradar-mwcw3x85.testnet`) stands in.
- **Owners** are NEAR accounts (`bet`, `withdraw`) or ed25519 keys. A key signs `{contract}|radar-pools|{owner}|nonce:{n}|{action}`, and anyone can submit it with `bet_signed`. The per-owner nonce makes every signature single-use, and nobody can bet another owner's balance.
- **Payout** = winning stake × whole pot ÷ winning pool. Anyone can call `claim`, but the money only goes to the position's owner. If the winning outcome has no backers, or the operator cancels, every stake is refunded.
- **Results** are posted by a named operator (`ops.mradar-mwcw3x85.testnet`) with a note and a source link. Quick rounds are settled from Coinbase's public 1-minute candle at the closing minute; matches from official results.
- **Relay** `web/api/pools.ts`: free test dollars (only when the balance is under $10), relays signed bets after checking the signature, claims, and opens and settles the 2-minute rounds.
- **Seeding:** pools open with $100 of test money split by the odds on Kalshi and Polymarket at deploy time (`contracts/scripts/deploy.mjs`).

**NEAR features used:**
- **Radar Pools:** a NEAR smart contract (pool betting, NEP-141 deposits, ed25519-signed bets relayed for players without a wallet).
- **Funding real venues:** NEAR Intents 1Click API for cross-chain settlement, with NEAR and USDC on NEAR as payment options.

## Run it yourself

```bash
cd web
npm install
npm run dev            # http://localhost:5173; serves /api/scout from the same handler as Vercel
npx tsc --noEmit -p .  # type-check
```

Searching and funding need no keys or secrets: every API they use is public. The Radar Pools relay needs the operator account in `web/.env.local` (`OPS_ACCOUNT_ID`, `OPS_PRIVATE_KEY`).

To deploy on Vercel, import the repository, set **Root Directory** to `web` (Vite preset), and add those two environment variables.

Radar Pools contracts:

```bash
cd contracts/pools && cargo test            # 15 tests: pro-rata payouts, 3 outcomes, refunds, replay, wrong key, closing time, operator only, one quick round per minute
cargo near build non-reproducible-wasm
cd ../test-token && cargo near build non-reproducible-wasm
cd ../scripts && npm install
node deploy.mjs <funded-testnet-account-key.json> <dir-for-new-keys>   # tusd, ops, pools + 7 seeded markets
```

## Repository layout

```
contracts/pools/      Radar Pools prediction market contract (new)
contracts/test-token/ tUSD test dollar (standard NEP-141, testnet only)
contracts/scripts/    deploy + seed markets
web/                  NEAR HACKATHON app (new)
  api/pools.ts        Radar Pools relay: test dollars, signed bets, claims, 2-minute rounds
  api/scout.ts        search + same-question comparison (Vercel function)
  api/_venues.ts      copy of src/venues.ts (npm run sync-venues keeps it identical)
  src/App.tsx         search, comparison, 4-step funding
  src/lib/intents.ts  NEAR Intents 1Click: destinations, coins, quotes, status
src/                  Market Radar PayBox plugin (pre-hackathon baseline, see below)
```

## Known limitations

- **Mainnet only, by nature.** NEAR Intents has no testnet (hackathon FAQ Q-007). The app shows real quotes and real deposit addresses, but no end-to-end payment into a venue was made during the hackathon.
- **Deposit addresses come from the user.** Market Radar can't look them up. The app checks the address format and asks the user to confirm the token and network their venue shows, because venues change these.
- **Matching is heuristic.** Venues word the same question differently (for example "hit $150k" and "be above $149,999.99 by Dec 31"). The app tells users to check each venue's exact rules before betting.
- **Radar Pools is testnet only, and its results are trusted.** A named operator posts each result with its source. A decentralised oracle and a challenge window are on the roadmap. The 2-minute rounds depend on Coinbase's public price API.
- **Pool prices move.** In pool betting, the final payout depends on bets placed after yours. The app shows the payout "as the pools stand now".
- **Some routes have minimums.** For example, USDT on Tron currently needs $100 or more. The app shows the minimum instead of failing.

## Roadmap

- **Bet without leaving Market Radar.** Today the user opens an account and places the bet on the venue itself (Market Radar links there and handles the funding). Next, the user connects their own venue wallet and Market Radar places the order for them, signed by that wallet. Polymarket supports this for third-party apps through its order API and builder programme; it needs Polymarket's approval and careful key handling, so it was out of scope for the hackathon.
- **Radar Pools on mainnet.** Only with the right licences in the countries served. It would also need a decentralised oracle with a challenge window instead of a trusted resolver, deposits from any coin through NEAR Intents (`customRecipientMsg` → `ft_transfer_call` into the pools), and a security audit.
- **Create a pool for any question.** When no venue lists a market, offer a Radar Pool for it. The pre-hackathon plugin already drafts these proposals.
- **Price-gap alerts.** Notify the user when the same question is cheaper on one venue by more than a set number of cents.
- **Market Radar for AI agents on NEAR.** Expose search, comparison and funding as tools an agent can call, for example "find the cheapest odds on Bitcoin $100k and fund it from my NEAR wallet".

## Disclosure

- **Pre-hackathon baseline (not judged).** Market Radar started as a [PayBox](https://paybox.sh) plugin for AI agents, written on 2026-10-17 to 2026-10-19 for the MoonPay hackathon. It's frozen in the [`pre-hackathon`](https://github.com/Bellickkruz/market-radar/tree/pre-hackathon) branch. The section [Market Radar PayBox plugin](#market-radar-paybox-plugin-pre-hackathon) below describes it.
- **Built during NEAR HACKATHON:** everything under `web/` (the NEAR Intents funding flow, the same-question comparison, the web interface and the search API) and `contracts/` (Radar Pools and its test token). See the [diff from the baseline](https://github.com/Bellickkruz/market-radar/compare/pre-hackathon...main). `web/api/_venues.ts` is a copy of the baseline's venue adapters, reused as a library (FAQ Q-005).
- **Second project.** The author also submits [PayPact](https://github.com/Bellickkruz/paypact). The two share no code.
- **AI assistance.** The code was written with Claude Code (Anthropic) as a pair programmer, directed and tested by the author.
- **Libraries:** `react` 19, `vite` 8, `qrcode`, TypeScript.
- **Services:** NEAR Intents 1Click API, and the public APIs of Polymarket (Gamma), Kalshi, Limitless and Manifold.

## License

MIT, see [LICENSE](LICENSE).

---

# Market Radar PayBox plugin (pre-hackathon)

**One search across every prediction market, then bet from your PayBox wallet.**

A [PayBox](https://paybox.sh) marketplace plugin built for the MoonPay Hackathons, Chapter 1 (Agents & PayBox), by [@Bellickkruz](https://x.com/Bellickkruz).

Demo video: https://x.com/Bellickkruz/status/2111582390350934519

## What it does

Type a hunch in plain words, like *"use Market Radar: PSG vs Barcelona"* or *"prediction markets for nigeria 2027 election"*, and your AI agent can:

| Tool | What it does |
|---|---|
| `scout_markets` | Searches **Polymarket, Kalshi, Limitless and Manifold** at once and ranks matches by relevance, venue trust and volume, with live YES/NO prices and links. It understands casual prompts ("I want to bet on Arsenal…"), team short names (PSG, Barça, Man Utd) and matchups ("X vs Y" must match both sides). |
| `prepare_bet` | Builds a trade ticket with live price, shares, payout and profit for a stake. It routes the bet through PayBox's **World** plugin when World lists the same market, so the user approves with a passkey from their PayBox wallet. Otherwise it gives the direct venue link. |
| `suggest_market` | When no market exists, drafts a ready-to-send proposal (question, resolution criteria, close date, pitch) and lists where to propose or create it. |
| `exit_check` | For a position you hold (e.g. on World): compares your current sell price with what Kalshi, Polymarket, Limitless and Manifold price the **same outcome**, shows profit or loss, and gives a hold-or-sell signal plus the exact sell step through World. |
| `find_liquidity` | Ranks prediction markets paying the biggest liquidity rewards (Polymarket rewards, Limitless daily rewards), with the size and spread rules to qualify. |

All five tools are read-only. Market Radar never moves funds; bets go through PayBox's own approval and signing flow.

Ask *"Market Radar: should I sell my Barcelona position?"* and the agent reads your World position and current bid, then `exit_check` tells you whether that price is above, below or in line with other markets. The hackathon entry (v6) has the first four tools; `exit_check` was added afterwards.

## How a bet flows

```
user idea ──► scout_markets ──► compare Polymarket · Kalshi · Limitless · Manifold
                                   │
                                   ▼
                     agent checks World (PayBox plugin)
                     ├─ listed  ──► world_buy_outcome ──► passkey approval ──► bet placed
                     └─ not listed ──► venue link for the user
```

Polymarket, Kalshi and Limitless take orders as off-chain signed messages, which PayBox plugins can't submit, so in-wallet betting goes through World (a Solana prediction market). The agent only calls Market Radar when the user mentions it or PayBox, or clearly asks about markets, odds or betting. Plain news questions get a normal answer.

## Build and test

Requires Node.js 24 and pnpm 11.11.0 (PayBox plugin starter 1.0.2).

```bash
pnpm install --frozen-lockfile
pnpm test        # type-check, two reproducible builds, MCP conformance
```

Upload `dist/plugin.mjs` in the PayBox developer portal and allow these network hosts. No secrets are needed.

```
gamma-api.polymarket.com
clob.polymarket.com
api.elections.kalshi.com
api.limitless.exchange
api.manifold.markets
```

## Project layout

- `src/plugin.ts`: the five MCP tools, ranking, routing and proposal drafting
- `src/venues.ts`: read-only adapters for each venue, query cleanup, aliases and relevance scoring
- `src/paybox.ts`, `scripts/`: PayBox starter tooling (unchanged)

## Notes

- Manifold is play money (mana) and is labelled as such. It's shown as a crowd signal only.
- Reward programs for suggesting markets are listed only where confirmed; otherwise the plugin says so.
- Prices are live quotes; fills can differ with order-book depth and fees.
