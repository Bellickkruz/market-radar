# Market Radar 🛰️

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
| `find_liquidity` | Ranks prediction markets paying the biggest liquidity rewards (Polymarket rewards, Limitless daily rewards), with the size and spread rules to qualify. |

All four tools are read-only. Market Radar never moves funds; bets go through PayBox's own approval and signing flow.

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

- `src/plugin.ts`: the four MCP tools, ranking, routing and proposal drafting
- `src/venues.ts`: read-only adapters for each venue, query cleanup, aliases and relevance scoring
- `src/paybox.ts`, `scripts/`: PayBox starter tooling (unchanged)

## Notes

- Manifold is play money (mana) and is labelled as such. It's shown as a crowd signal only.
- Reward programs for suggesting markets are listed only where confirmed; otherwise the plugin says so.
- Prices are live quotes; fills can differ with order-book depth and fees.
