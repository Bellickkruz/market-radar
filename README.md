# Market Radar 🛰️

**Find the best odds on any prediction market. Fund it from any coin, through NEAR Intents.**

- **Live app (NEAR HACKATHON entry):** _deploying; link added here once live_
- **What was built for NEAR HACKATHON:** the `web/` app, compared with the pre-hackathon baseline in [`pre-hackathon...main`](https://github.com/Bellickkruz/market-radar/compare/pre-hackathon...main) (see [Disclosure](#disclosure))
- **Tracks:** `defi` (cross-chain settlement through NEAR Intents), `realworld` (stablecoin payments for consumers)
- **Other project by the same author:** [PayPact](https://github.com/Bellickkruz/paypact), escrowed invoice links on NEAR. The two projects share no code.

## The problem

The same question ("Will Bitcoin reach $100k by the end of 2026?") trades on several prediction markets at different prices: in a live check on 2026-11-12, YES cost 9¢ on Kalshi and 5.5¢ on Polymarket. Finding the cheapest venue means searching each one separately. Using it is worse, because every venue takes money on a different chain: Polymarket wants USDC on Polygon, Limitless wants USDC on Base, and Kalshi takes USDC on networks such as Solana or Base. Someone holding NEAR, ETH, SOL or BTC first has to bridge and swap their way there.

## What Market Radar on NEAR does

1. **One search across 4 venues.** Type a hunch in plain words. Market Radar searches Polymarket, Kalshi, Limitless and Manifold at once and ranks the results by how well they match, how much they trade and how trustworthy the venue is.
2. **Same question, compared.** When several venues list the same question, it puts them side by side, marks the cheapest YES and NO among real-money venues, and shows the price gap. Two markets count as the same question only when their price levels ($149,999.99 counts as $150k), years, direction ("hit" is not "dip to") and subject words agree.
3. **Fund it from any coin.** Tap a price, choose a stake, and paste your own deposit address from that venue. Market Radar asks NEAR Intents (1Click API) for a quote that delivers exactly that many dollars of USDC to that address on the venue's chain. You pay with NEAR, USDC on NEAR, ETH, SOL, BTC, USDT or USDC from another chain. Live prices for every coin are shown before you choose, and the deposit address, amount and QR code after.

Market Radar never holds money. The NEAR Intents deposit address forwards your coin, swapped to USDC, straight to your own venue account. If the swap can't complete, it refunds to an address you give.

## Try it (no wallet needed to see everything up to payment)

| # | Do | See |
|---|----|-----|
| 1 | Open the live app and tap the example **"Bitcoin above 150k"**, or type `bitcoin 100k`. | Results from Polymarket, Kalshi, Limitless and Manifold in about 2 s. A **📡 Same question on 3 venues** card shows Kalshi, Polymarket and Manifold side by side, with *cheapest* labels and the price gap in cents. |
| 2 | Tap the YES price marked **cheapest**. | A 4-step funding panel opens. Step 1 shows how many shares $50 buys and what they pay if YES wins. |
| 3 | Step 2: paste any valid address for the network shown (for testing, `0x52908400098527886E0F7030069857D2E4169EE7`) and tick the box. | The box can't be ticked until the address fits the network. Step 3 shows **live NEAR Intents prices** for delivering exactly $50 of USDC there, paid in 10 different coins (for example "0.0246 ETH", "14.05 NEAR"). Routes with a current minimum say so ("min $100"). |
| 4 | Step 3: pick **ETH on Ethereum**. Step 4: paste an Ethereum address for refunds. Tap **Get payment details**. | A real NEAR Intents deposit address with a QR code, the exact ETH to send, and "about 51 seconds later, $50 USDC arrives in your Polymarket account on Polygon". Status updates on its own every 6 s. **Nothing is sent unless you send it.** |
| 5 | Try `Arsenal`, `Nigeria election 2027` or `Fed rate cut`. | Sports and elections are matched across venues too. When no venue lists the same question, no comparison is shown rather than a wrong one. |

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

**NEAR features used:** NEAR Intents 1Click API for cross-chain settlement, with NEAR and USDC on NEAR as payment options.

## Run it yourself

```bash
cd web
npm install
npm run dev            # http://localhost:5173; serves /api/scout from the same handler as Vercel
npx tsc --noEmit -p .  # type-check
```

No keys or secrets are needed: every API used is public. To deploy on Vercel, import the repository and set **Root Directory** to `web` (Vite preset).

## Repository layout

```
web/                  NEAR HACKATHON app (new)
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
- **Some routes have minimums.** For example, USDT on Tron currently needs $100 or more. The app shows the minimum instead of failing.

## Disclosure

- **Pre-hackathon baseline (not judged).** Market Radar started as a [PayBox](https://paybox.sh) plugin for AI agents, written on 2026-10-17 to 2026-10-19 for the MoonPay hackathon. It's frozen in the [`pre-hackathon`](https://github.com/Bellickkruz/market-radar/tree/pre-hackathon) branch. The section [Market Radar PayBox plugin](#market-radar-paybox-plugin-pre-hackathon) below describes it.
- **Built during NEAR HACKATHON:** everything under `web/`, which is the NEAR Intents funding flow, the same-question comparison, the web interface and the search API. See the [diff from the baseline](https://github.com/Bellickkruz/market-radar/compare/pre-hackathon...main). `web/api/_venues.ts` is a copy of the baseline's venue adapters, reused as a library (FAQ Q-005).
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
