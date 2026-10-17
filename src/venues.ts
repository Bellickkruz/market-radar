// Read-only adapters for each prediction-market venue. Every adapter returns
// normalized markets so ranking and output never depend on venue quirks.

export type Venue = "polymarket" | "kalshi" | "limitless" | "manifold";

export interface Market {
  venue: Venue;
  market_ref: string;
  title: string;
  event_title: string | null;
  yes_price: number | null;
  no_price: number | null;
  volume: number | null;
  volume_unit: "USD" | "USDC" | "contracts" | "MANA";
  closes_at: string | null;
  url: string;
}

export const VENUES: Record<Venue, { name: string; trust: "regulated" | "high" | "medium" | "play_money"; trustScore: number; money: string; note: string }> = {
  kalshi: { name: "Kalshi", trust: "regulated", trustScore: 1, money: "USD", note: "CFTC-regulated US exchange." },
  polymarket: { name: "Polymarket", trust: "high", trustScore: 0.9, money: "USDC", note: "Largest crypto prediction market by volume; UMA-resolved." },
  limitless: { name: "Limitless", trust: "medium", trustScore: 0.7, money: "USDC", note: "Base-chain prediction market; smaller liquidity." },
  manifold: { name: "Manifold", trust: "play_money", trustScore: 0.3, money: "MANA", note: "Play money (mana), not withdrawable. Useful as a crowd signal only." },
};

export const HOSTS = {
  polymarketGamma: "gamma-api.polymarket.com",
  polymarketClob: "clob.polymarket.com",
  kalshi: "api.elections.kalshi.com",
  limitless: "api.limitless.exchange",
  manifold: "api.manifold.markets",
} as const;

const TIMEOUT_MS = 4000;

export async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "market-radar-paybox-plugin" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} returned HTTP ${res.status}`);
  return res.json();
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const round = (v: number | null, digits = 4) => (v == null ? null : Number(v.toFixed(digits)));
export const iso = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  // Normalizes "2026-10-17 14:00:00+00" (Polymarket) into a parseable timestamp.
  const d = typeof v === "number" ? new Date(v) : new Date(String(v).replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const parseList = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};
const q = encodeURIComponent;

// ---- Polymarket ----------------------------------------------------------

function polymarketMarket(m: any, event: any): Market | null {
  if (!m || m.closed || m.active === false || m.archived) return null;
  const outcomes = parseList(m.outcomes).map(String);
  const prices = parseList(m.outcomePrices).map(num);
  const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
  const label = m.groupItemTitle ? `${event?.title ?? m.question} — ${m.groupItemTitle}` : m.question;
  return {
    venue: "polymarket",
    market_ref: String(m.slug),
    title: String(m.question ?? label),
    event_title: event?.title ?? null,
    yes_price: round(yesIdx >= 0 ? prices[yesIdx] ?? null : prices[0] ?? null),
    no_price: round(yesIdx >= 0 ? prices[1 - yesIdx] ?? null : prices[1] ?? null),
    volume: round(num(m.volumeNum ?? m.volume), 0),
    volume_unit: "USD",
    closes_at: iso(m.endDate),
    url: `https://polymarket.com/event/${event?.slug ?? m.slug}`,
  };
}

export async function searchPolymarket(query: string): Promise<Market[]> {
  const data = await getJson(`https://${HOSTS.polymarketGamma}/public-search?q=${q(query)}&limit_per_type=10&events_status=active&sort=volume&ascending=false`);
  const out: Market[] = [];
  for (const event of data?.events ?? []) {
    if (event.closed) continue;
    for (const m of event.markets ?? []) {
      const market = polymarketMarket(m, event);
      if (market) out.push(market);
    }
  }
  return out;
}

export async function getPolymarket(slug: string): Promise<Market | null> {
  const data = await getJson(`https://${HOSTS.polymarketGamma}/markets?slug=${q(slug)}`);
  const m = Array.isArray(data) ? data[0] : null;
  return m ? polymarketMarket(m, m.events?.[0]) : null;
}

// ---- Kalshi --------------------------------------------------------------

function kalshiMarket(m: any, series: any): Market | null {
  if (!m || (m.result && m.result !== "") || (m.status && !["active", "open"].includes(m.status))) return null;
  const ask = num(m.yes_ask_dollars) ?? (num(m.yes_ask) != null ? num(m.yes_ask)! / 100 : null);
  const bid = num(m.yes_bid_dollars) ?? (num(m.yes_bid) != null ? num(m.yes_bid)! / 100 : null);
  const noAsk = num(m.no_ask_dollars);
  const seriesTicker = String(series?.series_ticker ?? m.series_ticker ?? m.event_ticker ?? m.ticker).split("-")[0]!;
  return {
    venue: "kalshi",
    market_ref: String(m.ticker),
    title:
      series?.event_title && /\b(wins|is the result)$/i.test(String(m.title))
        ? `${series.event_title}: ${m.title}`
        : m.yes_sub_title || m.yes_subtitle
          ? `${m.title ?? series?.event_title} — ${m.yes_sub_title || m.yes_subtitle}`
          : String(m.title ?? series?.event_title),
    event_title: series?.event_title ? [series.event_title, series.event_subtitle].filter(Boolean).join(" ") : null,
    yes_price: round(ask),
    no_price: round(noAsk ?? (bid != null ? 1 - bid : null)),
    volume: round(num(m.volume) ?? num(series?.total_volume), 0),
    volume_unit: "contracts",
    closes_at: iso(m.close_ts ?? m.close_time),
    url: `https://kalshi.com/markets/${seriesTicker.toLowerCase()}`,
  };
}

export async function searchKalshi(query: string): Promise<Market[]> {
  const data = await getJson(`https://${HOSTS.kalshi}/v1/search/series?query=${q(query)}&page_size=10`);
  const out: Market[] = [];
  for (const series of data?.current_page ?? []) {
    for (const m of (series.markets ?? []).slice(0, 4)) {
      const market = kalshiMarket(m, series);
      if (market) out.push(market);
    }
  }
  return out;
}

export async function getKalshi(ticker: string): Promise<Market | null> {
  const data = await getJson(`https://${HOSTS.kalshi}/trade-api/v2/markets/${q(ticker)}`);
  return data?.market ? kalshiMarket(data.market, null) : null;
}

// ---- Limitless -----------------------------------------------------------

function limitlessMarkets(m: any): Market[] {
  const subs: any[] = m.markets?.length ? m.markets : [m];
  return subs
    .filter((s) => !s.expired && s.status !== "RESOLVED")
    .map((s) => {
      const prices = parseList(s.prices).map(num);
      const sub = s !== m;
      return {
        venue: "limitless" as const,
        market_ref: String(s.slug),
        title: sub ? `${m.title} — ${s.title}` : String(m.title),
        event_title: sub ? String(m.title) : null,
        yes_price: round(prices[0] ?? null),
        no_price: round(prices[1] ?? null),
        volume: round(num(s.volumeFormatted ?? m.volumeFormatted), 0),
        volume_unit: "USDC" as const,
        closes_at: iso(s.expirationTimestamp ?? m.expirationTimestamp),
        url: `https://limitless.exchange/markets/${m.slug}`,
      };
    });
}

export async function searchLimitless(query: string): Promise<Market[]> {
  const data = await getJson(`https://${HOSTS.limitless}/markets/search?query=${q(query)}&limit=10`);
  return (data?.markets ?? []).flatMap(limitlessMarkets).slice(0, 20);
}

export async function getLimitless(slug: string): Promise<Market | null> {
  const data = await getJson(`https://${HOSTS.limitless}/markets/${q(slug)}`);
  return data ? limitlessMarkets(data).find((m) => m.market_ref === slug) ?? limitlessMarkets(data)[0] ?? null : null;
}

// ---- Manifold ------------------------------------------------------------

function manifoldMarket(m: any): Market | null {
  if (!m || m.isResolved || m.outcomeType !== "BINARY") return null;
  const p = num(m.probability);
  return {
    venue: "manifold",
    market_ref: String(m.slug ?? m.id),
    title: String(m.question),
    event_title: null,
    yes_price: round(p),
    no_price: round(p != null ? 1 - p : null),
    volume: round(num(m.volume), 0),
    volume_unit: "MANA",
    closes_at: iso(m.closeTime),
    url: String(m.url ?? `https://manifold.markets/market/${m.slug}`),
  };
}

export async function searchManifold(query: string): Promise<Market[]> {
  const data = await getJson(`https://${HOSTS.manifold}/v0/search-markets?term=${q(query)}&limit=10&filter=open&contractType=BINARY`);
  return (Array.isArray(data) ? data : []).map(manifoldMarket).filter((m): m is Market => m != null);
}

export async function getManifold(slug: string): Promise<Market | null> {
  return manifoldMarket(await getJson(`https://${HOSTS.manifold}/v0/slug/${q(slug)}`));
}

export const SEARCH: Record<Venue, (query: string) => Promise<Market[]>> = {
  polymarket: searchPolymarket,
  kalshi: searchKalshi,
  limitless: searchLimitless,
  manifold: searchManifold,
};

export const LOOKUP: Record<Venue, (ref: string) => Promise<Market | null>> = {
  polymarket: getPolymarket,
  kalshi: getKalshi,
  limitless: getLimitless,
  manifold: getManifold,
};

// ---- Ranking ---------------------------------------------------------------

const STOP = new Set("a an the will be is are to of in on by for at and or what who when how does do did than this that with before after hit reach above below over under vs v fc".split(" "));

// Common short names that venues spell out in full.
const ALIASES: Record<string, string> = {
  psg: "Paris Saint-Germain",
  barca: "Barcelona",
  "man utd": "Manchester United",
  "man united": "Manchester United",
  "man city": "Manchester City",
  spurs: "Tottenham",
  inter: "Inter Milan",
  bayern: "Bayern Munich",
  btc: "Bitcoin",
  eth: "Ethereum",
};

export function expandAliases(text: string): string {
  let out = text;
  for (const [short, full] of Object.entries(ALIASES)) {
    out = out.replace(new RegExp(`\\b${short}\\b`, "gi"), full);
  }
  return out;
}

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\$?(\d+(?:\.\d+)?)\s*k\b/g, (_, n) => String(Number(n) * 1000))
    .replace(/[,$%?!.:;"'()]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

// Words too common to identify a market on their own ("election" matches every election).
const GENERIC = new Set(
  "election elections presidential president win wins winner price market next new year game match championship league odds".split(" "),
);
export const isSpecific = (t: string) => !GENERIC.has(t) && !/^\d+$/.test(t);

// Words people wrap around the actual topic ("prediction markets for ... using paybox").
const FILLER = new Set(
  ("prediction predictions predict market markets bet bets betting wager wagers odds using use via through paybox wallet " +
    "find show me give get list search look looking any are there is i im i'm want wanna can you please on about for my " +
    "place trade trading available live all best top some polymarket kalshi limitless manifold with a an to radar check ask question").split(" "),
);

// Strips filler words but keeps the user's casing, so names like "Tinubu" still read as names.
export function extractTopic(query: string): string {
  const kept = query
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")));
  return kept.join(" ").trim() || query.trim();
}

// Capitalized words after the first ("Davido", "Tinubu") are treated as names the market must mention.
// The first word is skipped only when it is capitalized because it starts a question ("Will ...").
const QUESTION_START = /^(will|is|are|who|what|which|when|how|does|do|can|did)$/i;
export const names = (query: string) =>
  query
    .split(/\s+/)
    .filter((w, i) => /^[A-Z][\p{L}'-]+/u.test(w) && !(i === 0 && QUESTION_START.test(w)))
    .flatMap(tokens);

export function relevance(query: string, market: Market): number {
  const want = [...new Set(tokens(query))];
  if (!want.length) return 0;
  const have = new Set(tokens(`${market.title} ${market.event_title ?? ""}`));
  const matches = (t: string): boolean =>
    have.has(t) ||
    [...have].some((h) => h.length > 3 && t.length > 3 && (h.startsWith(t) || t.startsWith(h))) ||
    (ALIASES[t] != null && tokens(ALIASES[t]).some((a) => have.has(a)));
  const hits = want.filter(matches);
  // "PSG vs Barcelona": both sides of a matchup must appear, not just one team.
  const sides = query.split(/\s+(?:vs\.?|v\.?|versus|against)\s+/i);
  if (sides.length === 2 && !sides.every((side) => tokens(side).some(matches))) return 0;
  // When the query names something specific (a person, asset, team), at least one such word must match.
  if (want.some(isSpecific) && !hits.some(isSpecific)) return 0;
  const named = names(query).filter(isSpecific);
  if (named.length && !named.some((n) => hits.includes(n))) return 0;
  return hits.length / want.length;
}

export function score(query: string, m: Market): number {
  const rel = relevance(query, m);
  // Matching words in the market's own title beats matching only its parent event's title.
  const titleRel = relevance(query, { ...m, event_title: null });
  const vol = m.volume ? Math.min(1, Math.log10(m.volume + 1) / 7) * (m.volume_unit === "MANA" ? 0.3 : 1) : 0;
  return rel * 0.5 + titleRel * 0.2 + VENUES[m.venue].trustScore * 0.15 + vol * 0.15;
}
