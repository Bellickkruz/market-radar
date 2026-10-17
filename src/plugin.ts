import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { HOSTS, LOOKUP, SEARCH, VENUES, extractTopic, getJson, iso, isSpecific, names, relevance, score, tokens, type Market, type Venue } from "./venues.js";

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

async function scout(topic: string, venues: readonly Venue[]) {
  // Venue search is literal, so also search the single most distinctive word: a name if
  // the user typed one ("Tinubu"), else the longest specific word ("nigeria").
  const specific = tokens(topic).filter(isSpecific);
  const core = names(topic).filter(isSpecific)[0] ?? specific.sort((a, b) => b.length - a.length)[0];
  const queries = core && core !== topic.toLowerCase() ? [topic, core] : [topic];
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
        "Use ONLY when the user asks about prediction markets, odds, betting or trading on an outcome " +
        "(e.g. \"is there a market for...\", \"odds on...\", \"I want to bet on...\"). " +
        "Do NOT use to answer general news or factual questions such as \"will the Fed cut rates?\"; answer those normally " +
        "and at most offer to check prediction markets if the user wants.",
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
              `${m.volume != null ? `, vol ${m.volume.toLocaleString("en-US")} ${m.volume_unit}` : ""} (ref ${m.market_ref})`,
          )
        : [`No live market found for "${topic}". Draft proposal: ${noMarket!.proposal.question}`, ...PROPOSAL_PLATFORMS.map((p) => `- ${p.venue}: ${p.how_to_propose}`)];
      const failed = venueStatus.filter((v) => !v.ok).map((v) => v.venue);
      if (failed.length) lines.push(`Could not reach: ${failed.join(", ")}.`);
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
        route: z.enum(["paybox_world", "venue_link", "play_money_link"]),
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
      const route = venue === "manifold" ? "play_money_link" : venue === "kalshi" ? "paybox_world" : "venue_link";
      const unit = venue === "manifold" ? "M" : "$";
      const worldSteps = [
              `discover_plugins with query "World" (enable it at https://app.paybox.sh/plugins if disabled).`,
              `Call World's search tool with query "${m.event_title ?? m.title}" and pick the market with the same question and close date.`,
              `Call World's buy-outcome tool for the ${side.toUpperCase()} outcome with ${amount_usd} USD from the user's Solana wallet; the user approves with their passkey.`,
              `Poll the returned PayBox request ID until it succeeds before reporting the bet as placed.`,
              `If World does not list this market, give the user the venue link instead: ${m.url}`,
            ];
      const steps =
        route === "paybox_world"
          ? worldSteps
          : route === "venue_link"
            ? [
                `${VENUES[venue].name} takes bets as off-chain signed orders, which PayBox plugins cannot submit. First check whether World lists the same question:`,
                ...worldSteps,
              ]
            : [`Manifold uses play money; open ${m.url} to bet mana. No PayBox wallet transaction is involved.`];
      const text =
        `${side.toUpperCase()} on "${m.title}" (${VENUES[venue].name}) at ${price ?? "?"} → ~${shares ?? "?"} shares for ${unit}${amount_usd}; ` +
        `pays ~${unit}${payout ?? "?"} if it wins (profit ~${unit}${profit ?? "?"}). Route: ` +
        (route === "paybox_world" ? "PayBox World plugin (Solana wallet, passkey approval)." : route === "venue_link" ? `World if it lists the same market, else ${m.url}` : `play money at ${m.url}`);
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

  return server;
}

serveStdio(createServer, { legacy: "reject" });
