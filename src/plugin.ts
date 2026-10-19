import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { HOSTS, LOOKUP, SEARCH, VENUES, expandAliases, extractTopic, getJson, iso, isSpecific, mentions, names, outcomeLabel, relevance, score, tokens, type Market, type Venue } from "./venues.js";

const PROTOCOL_VERSION = "2026-07-28";
const VENUE_IDS = ["polymarket", "kalshi", "limitless", "manifold"] as const;

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const venueEnum = z.enum(VENUE_IDS);
const nullableNum = z.number().nullable();

const marketSchema = z.object({
  venue: venueEnum,
  venue_name: z.string(),
  trust: z.enum(["regulated", "high", "medium", "play_money"]),
  market_ref: z.string(),
  title: z.string(),
  event_title: z.string().nullable(),
  yes_price: nullableNum,
  no_price: nullableNum,
  implied_yes_probability_pct: nullableNum,
  volume: nullableNum,
  volume_unit: z.string(),
  closes_at: z.string().nullable(),
  url: z.string(),
  match_score: z.number(),
});

const platformSchema = z.object({
  venue: z.string(),
  how_to_propose: z.string(),
  url: z.string(),
  real_money: z.boolean(),
  reward_program: z.string(),
});

const textResult = <T extends Record<string, unknown>>(text: string, structuredContent: T) => ({
  content: [{ type: "text" as const, text }],
  structuredContent,
});

const pct = (p: number | null) => (p == null ? null : Math.round(p * 1000) / 10);

function present(m: Market, query: string) {
  const v = VENUES[m.venue];
  return {
    venue: m.venue,
    venue_name: v.name,
    trust: v.trust,
    market_ref: m.market_ref,
    title: m.title,
    event_title: m.event_title,
    yes_price: m.yes_price,
    no_price: m.no_price,
    implied_yes_probability_pct: pct(m.yes_price),
    volume: m.volume,
    volume_unit: m.volume_unit,
    closes_at: m.closes_at,
    url: m.url,
    match_score: Math.round(score(query, m) * 100) / 100,
  };
}

// Where to take an idea no venue lists yet. Reward programs are only stated
// where confirmed; otherwise the agent is told to check before promising one.
const PROPOSAL_PLATFORMS = [
  {
    venue: "Manifold",
    how_to_propose: "Create the market yourself right now; anyone can open a market (it costs some mana).",
    url: "https://manifold.markets/create",
    real_money: false,
    reward_program: "Creators can earn play-money (mana) bonuses when people trade their market; mana is not withdrawable.",
  },
  {
    venue: "Polymarket",
    how_to_propose: "Polymarket lists markets itself. Send the drafted proposal through its official community channels linked from polymarket.com.",
    url: "https://polymarket.com",
    real_money: true,
    reward_program: "No public reward for approved suggestions confirmed; check Polymarket's current announcements.",
  },
  {
    venue: "Kalshi",
    how_to_propose: "Kalshi lists markets itself after review. Submit the drafted proposal through Kalshi's official support or community channels.",
    url: "https://kalshi.com",
    real_money: true,
    reward_program: "No public reward for approved suggestions confirmed; check Kalshi's current announcements.",
  },
  {
    venue: "Limitless",
    how_to_propose: "Share the drafted proposal through Limitless's official community channels linked from limitless.exchange.",
    url: "https://limitless.exchange",
    real_money: true,
    reward_program: "No public reward for approved suggestions confirmed; check Limitless's current announcements.",
  },
];

function draftProposal(idea: string, closeDate?: string) {
  const clean = idea.trim().replace(/\s+/g, " ").replace(/[.?!]+$/, "");
  const year = Number(clean.match(/\b(20\d{2})\b/)?.[1]);
  const close =
    closeDate ??
    (year >= new Date().getUTCFullYear() ? `${year}-12-31` : new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10));
  const event = clean.replace(/^will\s+/i, "");
  const question = /^(will|is|does|do|can|who|what|which|when|how)\b/i.test(clean) ? `${clean}?` : `Will ${clean}${year ? "" : ` by ${close}`}?`;
  return {
    question,
    resolution_criteria:
      `Resolves YES if, by 23:59 UTC on ${close}, at least one widely cited public source confirms that ${event} ` +
      `(for example an official announcement or a major news report). Resolves NO otherwise.`,
    close_date: close,
    pitch: `Market proposal: "${question}" Closes ${close}. Clear public resolution source, broad interest, and no existing market on major venues as of ${new Date().toISOString().slice(0, 10)}.`,
  };
}

// World (PayBox's in-wallet Solana market) is reachable only through PayBox, so the agent checks it.
// Venue search is literal, so search the topic, its spelled-out form ("PSG" → "Paris Saint-Germain"),
// and the single most distinctive word: the longest name typed ("Barcelona"), else the longest specific word.
function searchTerms(topic: string): string[] {
  const longestFirst = (list: string[]) => [...list].sort((a, b) => b.length - a.length);
  const core = longestFirst(names(topic).filter(isSpecific))[0] ?? longestFirst(tokens(topic).filter(isSpecific))[0];
  return [...new Set([topic, expandAliases(topic), core].filter((q): q is string => !!q && q.length > 1))];
}

const worldNextStep = (topic: string) => {
  const [first, ...rest] = searchTerms(topic);
  return (
    `To bet with the PayBox wallet: search the PayBox World plugin (world_search, q "${first}"` +
    `${rest.length ? `; if nothing matches, try ${rest.map((t) => `"${t}"`).join(" or ")}` : ""}). ` +
    `If World lists the same market, buy it there with prepare_bet's steps; otherwise share the market links above so the user can bet on that venue.`
  );
};

async function scout(topic: string, venues: readonly Venue[]) {
  const queries = searchTerms(topic);
  const settled = await Promise.allSettled(
    venues.map(async (v) => {
      const results = await Promise.allSettled(queries.map((q) => SEARCH[v](q)));
      const ok = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      if (!ok.length && results.every((r) => r.status === "rejected")) throw (results[0] as PromiseRejectedResult).reason;
      const seen = new Set<string>();
      return ok.filter((m) => !seen.has(m.market_ref) && seen.add(m.market_ref));
    }),
  );
  const markets: Market[] = [];
  const venueStatus: { venue: Venue; ok: boolean; found: number; error: string | null }[] = [];
  settled.forEach((r, i) => {
    const venue = venues[i]!;
    if (r.status === "fulfilled") {
      const relevant = r.value.filter((m) => relevance(topic, m) >= 0.5);
      markets.push(...relevant);
      venueStatus.push({ venue, ok: true, found: relevant.length, error: null });
    } else {
      venueStatus.push({ venue, ok: false, found: 0, error: String(r.reason?.message ?? r.reason).slice(0, 160) });
    }
  });
  return { markets, venueStatus };
}

function createServer() {
  const server = new McpServer(
    { name: "market-radar", version: "1.0.0" },
    { supportedProtocolVersions: [PROTOCOL_VERSION] },
  );

  server.registerTool(
    "scout_markets",
    {
      title: "Scout prediction markets",
      description:
        "Type any idea or question and find every live prediction market for it across Polymarket, Kalshi, Limitless and Manifold, " +
        "ranked by match, venue trust and volume, with the best YES and NO prices. If nothing matches, returns where to propose the market " +
        "plus a ready-to-send proposal. Next step: prepare_bet on a chosen result. " +
        "Use when EITHER (1) the user mentions Market Radar or PayBox together with a topic or question " +
        "(e.g. \"use Market Radar: will the Fed cut rates in December?\", \"check PayBox for Arsenal odds\") — always call it then; " +
        "OR (2) the user asks about prediction markets, odds, betting or trading on an outcome " +
        "(e.g. \"is there a market for...\", \"odds on...\", \"I want to bet on...\"). " +
        "Otherwise do NOT use it for general news or factual questions such as a bare \"will the Fed cut rates?\"; answer those normally " +
        "and at most offer to check prediction markets with Market Radar.",
      inputSchema: z
        .object({
          query: z.string().min(2).max(200).describe("Plain words are fine, e.g. \"prediction markets for nigeria 2027 election\" or \"Bitcoin above 150k this year\""),
          limit: z.number().int().min(1).max(20).default(8).describe("Maximum markets to return"),
          include_play_money: z.boolean().default(true).describe("Include Manifold (play money) as a crowd signal"),
        })
        .strict(),
      outputSchema: z.object({
        query: z.string(),
        topic: z.string(),
        found: z.number().int(),
        markets: z.array(marketSchema),
        best_yes: marketSchema.nullable(),
        best_no: marketSchema.nullable(),
        venues_checked: z.array(z.object({ venue: venueEnum, ok: z.boolean(), found: z.number().int(), error: z.string().nullable() })),
        no_market: z
          .object({ proposal: z.object({ question: z.string(), resolution_criteria: z.string(), close_date: z.string(), pitch: z.string() }), platforms: z.array(platformSchema) })
          .nullable(),
        next_step: z.string(),
      }),
      annotations: readOnly,
    },
    async ({ query, limit, include_play_money }) => {
      const venues = VENUE_IDS.filter((v) => include_play_money || v !== "manifold");
      const topic = extractTopic(query);
      const { markets, venueStatus } = await scout(topic, venues);
      const perEvent = new Map<string, number>();
      const ranked = markets
        .sort((a, b) => score(topic, b) - score(topic, a))
        .filter((m) => {
          const key = `${m.venue}:${m.event_title ?? m.market_ref}`;
          perEvent.set(key, (perEvent.get(key) ?? 0) + 1);
          return perEvent.get(key)! <= 2;
        })
        .slice(0, limit)
        .map((m) => present(m, topic));
      // Best prices only among real-money venues.
      const real = ranked.filter((m) => m.trust !== "play_money");
      const best = (key: "yes_price" | "no_price") =>
        real.filter((m) => m[key] != null && m[key]! > 0).sort((a, b) => a[key]! - b[key]!)[0] ?? null;
      const noMarket = ranked.length ? null : { proposal: draftProposal(topic), platforms: PROPOSAL_PLATFORMS };
      const lines = ranked.length
        ? ranked.map(
            (m, i) =>
              `${i + 1}. [${m.venue_name}${m.trust === "play_money" ? ", play money" : ""}] ${m.title} — YES ${m.yes_price ?? "?"} / NO ${m.no_price ?? "?"}` +
              `${m.volume != null ? `, vol ${m.volume.toLocaleString("en-US")} ${m.volume_unit}` : ""}\n   ${m.url} (ref ${m.market_ref})`,
          )
        : [`No live market found for "${topic}". Draft proposal: ${noMarket!.proposal.question}`, ...PROPOSAL_PLATFORMS.map((p) => `- ${p.venue}: ${p.how_to_propose}`)];
      const failed = venueStatus.filter((v) => !v.ok).map((v) => v.venue);
      if (failed.length) lines.push(`Could not reach: ${failed.join(", ")}.`);
      const nextStep = worldNextStep(topic);
      lines.push("", nextStep);
      if (topic !== query.trim()) lines.unshift(`Searched for: "${topic}"`);
      return textResult(lines.join("\n"), {
        query,
        topic,
        found: ranked.length,
        markets: ranked,
        best_yes: best("yes_price"),
        best_no: best("no_price"),
        venues_checked: venueStatus,
        no_market: noMarket,
        next_step: nextStep,
      });
    },
  );

  server.registerTool(
    "prepare_bet",
    {
      title: "Prepare a bet",
      description:
        "Build a trade ticket for one market from scout_markets: live price, shares, payout and profit for a stake, and the execution route. " +
        "Bets settle through the PayBox World plugin (Solana wallet, passkey approval) when World lists the market; otherwise the ticket gives the venue link. " +
        "This tool never moves funds.",
      inputSchema: z
        .object({
          venue: venueEnum,
          market_ref: z.string().min(1).max(200).describe("market_ref from scout_markets"),
          side: z.enum(["yes", "no"]),
          amount_usd: z.number().positive().max(100_000).describe("Stake in USD/USDC"),
        })
        .strict(),
      outputSchema: z.object({
        market: marketSchema,
        side: z.enum(["yes", "no"]),
        stake_usd: z.number(),
        price: nullableNum,
        estimated_shares: nullableNum,
        payout_if_win_usd: nullableNum,
        profit_if_win_usd: nullableNum,
        route: z.enum(["world_or_venue_link", "play_money_link"]),
        paybox_steps: z.array(z.string()),
        venue_url: z.string(),
        warnings: z.array(z.string()),
      }),
      annotations: readOnly,
    },
    async ({ venue, market_ref, side, amount_usd }) => {
      const m = await LOOKUP[venue](market_ref);
      if (!m) throw new Error(`No open ${VENUES[venue].name} market found for ref "${market_ref}". Run scout_markets again.`);
      const shown = present(m, m.title);
      const price = side === "yes" ? m.yes_price : m.no_price;
      const shares = price && price > 0 ? Math.floor((amount_usd / price) * 100) / 100 : null;
      const payout = shares != null ? Math.round(shares * 100) / 100 : null;
      const profit = payout != null ? Math.round((payout - amount_usd) * 100) / 100 : null;
      const warnings: string[] = [];
      if (price == null) warnings.push("No live price available; check the venue before betting.");
      if (price != null && (price < 0.03 || price > 0.97)) warnings.push("Extreme price: thin upside or a long shot. Double-check before betting.");
      if (m.closes_at && Date.parse(m.closes_at) - Date.now() < 3_600_000) warnings.push("Market closes within an hour.");
      warnings.push("Estimates use the latest quoted price; the fill price can differ with order-book depth and fees.");
      const route = venue === "manifold" ? "play_money_link" : "world_or_venue_link";
      const unit = venue === "manifold" ? "M" : "$";
      const sizeAtomic = String(Math.round(amount_usd * 1_000_000));
      const steps =
        route === "world_or_venue_link"
          ? [
              `To bet inside PayBox, use the World plugin (PayBox's in-wallet prediction market on Solana). Enable it at https://app.paybox.sh/plugins if needed.`,
              `Call world_search with q "${m.event_title ?? m.title}" (try shorter keywords too). Only continue if World lists the SAME question and close date.`,
              `If it does: confirm the exact market and its ${side.toUpperCase()} mint with world_get_markets, then call world_buy_outcome with that mint and size "${sizeAtomic}" (atomic USDC = ${amount_usd} USD) from the user's Solana wallet; the user approves with their passkey. Poll get_request until it completes.`,
              `If World does not list it: give the user this ${VENUES[venue].name} link to bet there directly: ${m.url} (${VENUES[venue].name} orders cannot be signed through a PayBox plugin).`,
            ]
          : [`Manifold uses play money; open ${m.url} to bet mana. No PayBox wallet transaction is involved.`];
      const text =
        `${side.toUpperCase()} on "${m.title}" (${VENUES[venue].name}) at ${price ?? "?"} → ~${shares ?? "?"} shares for ${unit}${amount_usd}; ` +
        `pays ~${unit}${payout ?? "?"} if it wins (profit ~${unit}${profit ?? "?"}).\n` +
        (route === "world_or_venue_link"
          ? `Bet in PayBox via World if World lists this market; otherwise bet on ${VENUES[venue].name}: ${m.url}`
          : `Play money: ${m.url}`);
      return textResult(text, {
        market: shown,
        side,
        stake_usd: amount_usd,
        price,
        estimated_shares: shares,
        payout_if_win_usd: payout,
        profit_if_win_usd: profit,
        route,
        paybox_steps: steps,
        venue_url: m.url,
        warnings,
      });
    },
  );

  server.registerTool(
    "suggest_market",
    {
      title: "Suggest a new market",
      description:
        "For an idea with no live market: drafts a market proposal (question, resolution criteria, close date, pitch) and lists where to propose or create it, " +
        "including which platforms reward creators. Use only when the user wants to create or propose a market, " +
        "or after scout_markets found no market and the user wants one.",
      inputSchema: z
        .object({
          idea: z.string().min(3).max(200),
          close_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD; defaults to 90 days out"),
        })
        .strict(),
      outputSchema: z.object({
        proposal: z.object({ question: z.string(), resolution_criteria: z.string(), close_date: z.string(), pitch: z.string() }),
        platforms: z.array(platformSchema),
      }),
      annotations: { ...readOnly, openWorldHint: false },
    },
    async ({ idea, close_date }) => {
      const proposal = draftProposal(idea, close_date);
      return textResult(
        [`Proposal: ${proposal.question}`, `Resolution: ${proposal.resolution_criteria}`, ...PROPOSAL_PLATFORMS.map((p) => `- ${p.venue}: ${p.how_to_propose} Reward: ${p.reward_program}`)].join("\n"),
        { proposal, platforms: PROPOSAL_PLATFORMS },
      );
    },
  );

  server.registerTool(
    "find_liquidity",
    {
      title: "Find liquidity opportunities",
      description:
        "Ranks prediction markets where providing liquidity (two-sided limit orders) earns venue rewards, by daily reward pool. " +
        "Polymarket liquidity rewards and Limitless daily rewards; optional topic filter. " +
        "Use only when the user asks about providing liquidity, market making or earning maker rewards on prediction markets.",
      inputSchema: z
        .object({
          topic: z.string().min(2).max(100).optional().describe("e.g. \"bitcoin\" or \"election\"; omit for the top pools overall"),
          limit: z.number().int().min(1).max(20).default(10),
        })
        .strict(),
      outputSchema: z.object({
        opportunities: z.array(
          z.object({
            venue: venueEnum,
            title: z.string(),
            daily_reward: z.number(),
            reward_unit: z.string(),
            min_order_size: nullableNum,
            max_spread_cents: nullableNum,
            current_spread: nullableNum,
            volume_24h: nullableNum,
            yes_price: nullableNum,
            closes_at: z.string().nullable(),
            url: z.string(),
          }),
        ),
        how_it_works: z.string(),
        venues_checked: z.array(z.object({ venue: venueEnum, ok: z.boolean(), error: z.string().nullable() })),
      }),
      annotations: readOnly,
    },
    async ({ topic, limit }) => {
      const pm = getJson(
        `https://${HOSTS.polymarketClob}/rewards/markets/multi?page_size=50&order_by=rate_per_day&position=DESC` +
          (topic ? `&q=${encodeURIComponent(topic)}` : ""),
      ).then((d: any) =>
        (d?.data ?? []).map((r: any) => {
          const rate = (r.rewards_config ?? []).reduce((s: number, c: any) => s + (Number(c.rate_per_day) || 0), 0);
          const yes = (r.tokens ?? []).find((t: any) => String(t.outcome).toLowerCase() === "yes") ?? r.tokens?.[0];
          return {
            venue: "polymarket" as const,
            title: r.group_item_title && !String(r.question).includes(r.group_item_title) ? `${r.question} — ${r.group_item_title}` : String(r.question),
            daily_reward: rate,
            reward_unit: "USDC/day (pool shared by qualifying makers)",
            min_order_size: Number(r.rewards_min_size) || null,
            max_spread_cents: Number(r.rewards_max_spread) || null,
            current_spread: Number.isFinite(Number(r.spread)) ? Number(r.spread) : null,
            volume_24h: Number.isFinite(Number(r.volume_24hr)) ? Math.round(Number(r.volume_24hr)) : null,
            yes_price: yes ? Number(yes.price) : null,
            closes_at: iso(r.end_date),
            url: `https://polymarket.com/event/${r.event_slug ?? r.market_slug}`,
          };
        }),
      );
      const lim = getJson(
        topic
          ? `https://${HOSTS.limitless}/markets/search?query=${encodeURIComponent(topic)}&limit=25`
          : `https://${HOSTS.limitless}/markets/active?limit=25`,
      ).then((d: any) =>
        (d?.markets ?? d?.data ?? [])
          .filter((m: any) => Number(m.dailyReward) > 0 && !m.expired)
          .map((m: any) => ({
            venue: "limitless" as const,
            title: String(m.title),
            daily_reward: Number(m.dailyReward),
            reward_unit: "daily reward as reported by Limitless",
            min_order_size: null,
            max_spread_cents: null,
            current_spread: null,
            volume_24h: null,
            yes_price: null,
            closes_at: m.expirationTimestamp ? new Date(Number(m.expirationTimestamp)).toISOString() : null,
            url: `https://limitless.exchange/markets/${m.slug}`,
          })),
      );
      const [pmR, limR] = await Promise.allSettled([pm, lim]);
      const opportunities = [pmR, limR]
        .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
        // Skip pools that close within the hour (e.g. games about to start).
        .filter((o) => o.daily_reward > 0 && (!o.closes_at || Date.parse(o.closes_at) > Date.now() + 3_600_000))
        .sort((a, b) => b.daily_reward - a.daily_reward)
        .slice(0, limit);
      const venuesChecked = [
        { venue: "polymarket" as const, ok: pmR.status === "fulfilled", error: pmR.status === "rejected" ? String(pmR.reason?.message ?? pmR.reason).slice(0, 160) : null },
        { venue: "limitless" as const, ok: limR.status === "fulfilled", error: limR.status === "rejected" ? String(limR.reason?.message ?? limR.reason).slice(0, 160) : null },
      ];
      const howItWorks =
        "Liquidity rewards pay makers who keep two-sided limit orders resting close to the midpoint. On Polymarket an order must be at least " +
        "min_order_size shares and within max_spread_cents of the midpoint to qualify; the daily pool is split among qualifying makers by size and tightness. " +
        "Orders are placed on the venue itself; resting orders carry inventory risk if the price moves.";
      const text = opportunities.length
        ? opportunities
            .map((o, i) => `${i + 1}. [${VENUES[o.venue as Venue].name}] ${o.title} — ${o.daily_reward} ${o.reward_unit}${o.max_spread_cents ? `, within ${o.max_spread_cents}¢` : ""}`)
            .join("\n")
        : `No rewarded liquidity pools found${topic ? ` for "${topic}"` : ""}.`;
      return textResult(text, { opportunities, how_it_works: howItWorks, venues_checked: venuesChecked });
    },
  );

  server.registerTool(
    "exit_check",
    {
      title: "Check whether to exit a position",
      description:
        "For a prediction-market position the user holds (typically on PayBox's World plugin): compares the price the user can sell at now " +
        "with what Kalshi, Polymarket, Limitless and Manifold price the same outcome, shows profit or loss, and gives a hold-or-sell signal " +
        "with the exact sell step. Before calling, get the position from world_positions (shares and entry price if known) and the current " +
        "bid for the held side from world_orderbook, and pass them in. Use when the user asks whether to sell, exit, cash out or hold a position. " +
        "This tool never moves funds and is not financial advice.",
      inputSchema: z
        .object({
          event: z.string().min(2).max(200).describe("The market or match, e.g. \"PSG vs Barcelona\" or \"Bitcoin above $200k in 2026\""),
          outcome: z.string().min(1).max(80).optional().describe("The outcome held in a multi-outcome event, e.g. \"Barcelona\" or \"Draw\""),
          side: z.enum(["yes", "no"]).default("yes"),
          current_bid: z.number().gt(0).lt(1).optional().describe("Price the user can sell at now, e.g. World's best bid for the held side"),
          entry_price: z.number().gt(0).lt(1).optional().describe("Average price paid per share"),
          shares: z.number().positive().optional().describe("Number of outcome shares held"),
        })
        .strict(),
      outputSchema: z.object({
        event: z.string(),
        outcome: z.string().nullable(),
        side: z.enum(["yes", "no"]),
        position: z.object({
          shares: nullableNum,
          entry_price: nullableNum,
          current_bid: nullableNum,
          cost_usd: nullableNum,
          value_now_usd: nullableNum,
          pnl_usd: nullableNum,
          pnl_pct: nullableNum,
          payout_if_win_usd: nullableNum,
        }),
        other_venues: z.array(z.object({ venue: venueEnum, venue_name: z.string(), title: z.string(), price: z.number(), url: z.string(), play_money: z.boolean() })),
        consensus_price: nullableNum,
        signal: z.enum(["sell_price_above_market", "sell_price_below_market", "in_line_with_market", "no_comparison"]),
        summary: z.string(),
        reasons: z.array(z.string()),
        sell_steps: z.array(z.string()),
      }),
      annotations: readOnly,
    },
    async ({ event, outcome, side, current_bid, entry_price, shares }) => {
      const topic = extractTopic(event);
      const { markets } = await scout(topic, VENUE_IDS);
      // Same outcome on other venues: the outcome must be named in the market's own outcome label,
      // and draws only match draws.
      // Price levels in the event ("200k", "2026") must all appear, so $150k markets don't stand in for $200k.
      const levels = tokens(topic).filter((t) => /^\d{4,}$/.test(t));
      const sameOutcome = markets.filter((m) => {
        const title = tokens(`${m.title} ${m.event_title ?? ""}`);
        if (!levels.every((l) => title.includes(l))) return false;
        if (!outcome) return true;
        const { label, fromTitle } = outcomeLabel(m);
        const isDraw = /\b(draw|tie)\b/i.test(label);
        if (/^(draw|tie)$/i.test(outcome.trim())) return isDraw;
        // A full-title market only counts when it asks whether this outcome wins ("Will FC Barcelona win…")
        // and does not name the opponent ("Will Paris win the match Barcelona VS Paris?" is about Paris).
        const opponents = topic
          .split(/\s+(?:vs\.?|v\.?|versus|against)\s+/i)
          .filter((side) => !mentions(side, outcome))
          .flatMap((side) => tokens(expandAliases(side)).filter(isSpecific));
        const labelTokens = tokens(label);
        return (
          !isDraw &&
          mentions(label, outcome) &&
          (!fromTitle || (/\bwins?\b/i.test(label) && !opponents.some((t) => labelTokens.includes(t))))
        );
      });
      const priced = sameOutcome
        .map((m) => ({ m, price: side === "yes" ? m.yes_price : m.no_price }))
        .filter((r): r is { m: Market; price: number } => r.price != null && r.price > 0 && r.price < 1)
        .sort((a, b) => score(topic, b.m) - score(topic, a.m))
        .slice(0, 6);
      const real = priced.filter((r) => r.m.venue !== "manifold");
      const consensus = real.length ? Math.round((real.reduce((s, r) => s + r.price, 0) / real.length) * 1000) / 1000 : null;

      const money = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);
      const cost = shares != null && entry_price != null ? money(shares * entry_price) : null;
      const valueNow = shares != null && current_bid != null ? money(shares * current_bid) : null;
      const pnl = cost != null && valueNow != null ? money(valueNow - cost) : null;
      const pnlPct = cost && pnl != null ? Math.round((pnl / cost) * 1000) / 10 : null;

      const reasons: string[] = [];
      let signal: "sell_price_above_market" | "sell_price_below_market" | "in_line_with_market" | "no_comparison" = "no_comparison";
      if (current_bid != null && consensus != null) {
        const edge = current_bid - consensus;
        const cents = (n: number) => `${Math.round(n * 1000) / 10}¢`;
        if (edge >= 0.02) {
          signal = "sell_price_above_market";
          reasons.push(`Your sell price (${cents(current_bid)}) is ${cents(edge)} above what other markets price this at (${cents(consensus)}). Selling now locks in a better-than-market price.`);
        } else if (edge <= -0.03) {
          signal = "sell_price_below_market";
          reasons.push(`Your sell price (${cents(current_bid)}) is ${cents(-edge)} below other markets (${cents(consensus)}). Selling now gives up value; holding or waiting for a better bid may pay more.`);
        } else {
          signal = "in_line_with_market";
          reasons.push(`Your sell price (${cents(current_bid)}) is in line with other markets (${cents(consensus)}), so it comes down to your own view of the outcome.`);
        }
      } else if (current_bid == null) {
        reasons.push("No current sell price was given; fetch the held side's best bid with world_orderbook for a full comparison.");
      } else {
        reasons.push("No matching market on other venues to compare against.");
      }
      if (pnl != null) reasons.push(`Selling now: ${pnl >= 0 ? "profit" : "loss"} of $${Math.abs(pnl)} (${pnlPct}%) on $${cost} paid.`);
      const payout = shares != null ? money(shares) : null;
      if (payout != null) reasons.push(`Holding to a win pays $${payout}; a loss pays $0.`);
      const closes = priced.map((r) => r.m.closes_at).filter((c): c is string => !!c).sort()[0];
      if (closes) {
        const hours = (Date.parse(closes) - Date.now()) / 3_600_000;
        if (hours > 0 && hours < 48) reasons.push(`The market closes in about ${Math.round(hours)} hours, so prices can move fast.`);
      }

      const sellSteps = [
        `Call world_positions to confirm the exact outcome mint and the share balance (atomic outcome-token units).`,
        `To sell, call world_change_position with side "sell", that market_mint, and size in atomic outcome-token units (all shares, or part of them).`,
        `The user approves with their passkey; poll get_request until it completes. Proceeds return as USDC to the PayBox Solana wallet.`,
      ];
      const headline =
        signal === "sell_price_above_market"
          ? "Selling now beats the market price."
          : signal === "sell_price_below_market"
            ? "Your sell price is below the market; selling now gives up value."
            : signal === "in_line_with_market"
              ? "Your sell price matches the market; it is your call."
              : "Not enough data for a cross-market comparison.";
      const otherVenues = priced.map((r) => ({
        venue: r.m.venue,
        venue_name: VENUES[r.m.venue].name,
        title: r.m.title,
        price: r.price,
        url: r.m.url,
        play_money: r.m.venue === "manifold",
      }));
      const lines = [
        `${headline} (${side.toUpperCase()}${outcome ? ` ${outcome}` : ""}, ${event})`,
        ...reasons.map((r) => `- ${r}`),
        ...otherVenues.map((v) => `  ${v.venue_name}${v.play_money ? " (play money)" : ""}: ${v.price} — ${v.title} ${v.url}`),
        "Signal only, not financial advice.",
      ];
      return textResult(lines.join("\n"), {
        event,
        outcome: outcome ?? null,
        side,
        position: {
          shares: shares ?? null,
          entry_price: entry_price ?? null,
          current_bid: current_bid ?? null,
          cost_usd: cost,
          value_now_usd: valueNow,
          pnl_usd: pnl,
          pnl_pct: pnlPct,
          payout_if_win_usd: payout,
        },
        other_venues: otherVenues,
        consensus_price: consensus,
        signal,
        summary: headline,
        reasons,
        sell_steps: sellSteps,
      });
    },
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
