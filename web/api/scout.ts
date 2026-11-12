// GET /api/scout?q=... : search Polymarket, Kalshi, Limitless and Manifold at once.
// Same matching and ranking as the Market Radar PayBox plugin (api/_venues.ts is a copy
// of src/venues.ts), returned as JSON for the web app. Read-only; no keys needed.
import { SEARCH, VENUES, expandAliases, extractTopic, isSpecific, names, relevance, score, tokens, type Market, type Venue } from "./_venues.js";

const VENUE_IDS: Venue[] = ["polymarket", "kalshi", "limitless", "manifold"];

/** The topic, its spelled-out form ("PSG" -> "Paris Saint-Germain") and its most distinctive word. */
function searchTerms(topic: string): string[] {
  const longestFirst = (list: string[]) => [...list].sort((a, b) => b.length - a.length);
  const core = longestFirst(names(topic).filter(isSpecific))[0] ?? longestFirst(tokens(topic).filter(isSpecific))[0];
  return [...new Set([topic, expandAliases(topic), core].filter((q): q is string => !!q && q.length > 1))];
}

async function scout(topic: string) {
  const queries = searchTerms(topic);
  const settled = await Promise.allSettled(
    VENUE_IDS.map(async (v) => {
      const results = await Promise.allSettled(queries.map((q) => SEARCH[v](q)));
      const ok = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      if (!ok.length && results.every((r) => r.status === "rejected")) throw (results[0] as PromiseRejectedResult).reason;
      const seen = new Set<string>();
      return ok.filter((m) => !seen.has(m.market_ref) && seen.add(m.market_ref));
    }),
  );
  const markets: Market[] = [];
  const venues = settled.map((r, i) => {
    const venue = VENUE_IDS[i]!;
    if (r.status === "rejected") return { venue, ok: false, found: 0 };
    const relevant = r.value.filter((m) => relevance(topic, m) >= 0.5);
    markets.push(...relevant);
    return { venue, ok: true, found: relevant.length };
  });
  return { markets, venues };
}

// ---------------------------------------------------------------- same question, other venues

const UP = /\b(hit|hits|reach|reaches|above|over|exceed|exceeds|higher|rise|rises|surpass|at least|or more)\b/i;
const DOWN = /\b(dip|dips|below|under|fall|falls|drop|drops|lower|crash|less than)\b/i;
const direction = (t: string) => (UP.test(t) && !DOWN.test(t) ? "up" : DOWN.test(t) && !UP.test(t) ? "down" : "any");

const MONTH_DAY = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?\b/gi;
const CLOCK = /\b\d{1,2}:\d{2}\s*(am|pm)?\b/gi;

/** Numbers and years in a question, ignoring dates and clock times:
 *  "$150k by Dec 31, 2026 at 11:59PM" -> levels [150000], years [2026]; "cut rates 0 times" -> levels [0]. */
function levelsOf(text: string) {
  const clean = text
    .replace(MONTH_DAY, " ")
    .replace(CLOCK, " ")
    // "$149,999.99" -> "150000": prices with cents are one number, not two.
    .replace(/\d[\d,]*\.\d+/g, (n) => String(Math.round(Number(n.replace(/,/g, "")))));
  const nums = tokens(clean).map(Number).filter((n) => Number.isFinite(n));
  const years = nums.filter((n) => Number.isInteger(n) && n >= 2020 && n <= 2040);
  return { years: [...new Set(years)], levels: [...new Set(nums.filter((n) => !years.includes(n)))] };
}
const levels = (m: Market) => levelsOf(`${m.title} ${m.event_title ?? ""}`);

const near = (a: number, b: number) => a === b || Math.abs(a - b) <= Math.max(a, b) * 0.005; // $149,999.99 ~ $150,000
const specific = (text: string) => new Set(tokens(text).filter(isSpecific));
/** Share of the smaller word set that the other one also has. */
function overlap(a: string, b: string) {
  const ta = specific(a), tb = specific(b);
  return [...ta].filter((t) => tb.has(t)).length / Math.max(1, Math.min(ta.size, tb.size));
}

/** Does a market ask what the user typed? Every number in the query must be in it, in the same direction. */
function fitsQuery(topic: string, m: Market): boolean {
  const q = levelsOf(topic), lm = levels(m);
  if (!q.levels.every((x) => lm.levels.some((y) => near(x, y)))) return false;
  if (!q.years.every((y) => lm.years.includes(y))) return false;
  const dq = direction(topic), dm = direction(m.title);
  return dq === "any" || dm === "any" || dq === dm;
}

/** Do two markets ask the same question? Levels and years must agree, and so must the direction. */
function sameQuestion(a: Market, b: Market): boolean {
  const la = levels(a), lb = levels(b);
  if (!la.levels.every((x) => lb.levels.some((y) => near(x, y))) || !lb.levels.every((y) => la.levels.some((x) => near(x, y)))) return false;
  if (la.years.length && lb.years.length && !la.years.some((y) => lb.years.includes(y))) return false;
  const da = direction(a.title), db = direction(b.title);
  if (da !== "any" && db !== "any" && da !== db) return false;
  // The questions' own words must overlap too (the same year is not the same question).
  // With matching price levels, sharing the subject ("Bitcoin") is enough, since venues
  // phrase the same question differently ("hit $150k" vs "be above $149,999.99").
  return la.levels.length ? overlap(a.title, b.title) > 0 : overlap(a.title, b.title) >= 0.75;
}

/**
 * The best match on one real-money venue, plus the same question on every other venue that
 * lists it: this is where comparing prices means something.
 */
function compare<T extends Market & { trust: string }>(ranked: T[]) {
  const anchor = ranked.find((m) => m.trust !== "play_money");
  if (!anchor) return null;
  const rows: T[] = [anchor];
  for (const m of ranked) {
    if (rows.some((r) => r.venue === m.venue)) continue;
    if (sameQuestion(anchor, m)) rows.push(m);
  }
  if (rows.length < 2) return null;
  const real = rows.filter((m) => m.trust !== "play_money");
  const cheapest = (k: "yes_price" | "no_price") =>
    real.filter((m) => m[k] != null && m[k]! > 0 && m[k]! < 1).sort((a, b) => a[k]! - b[k]!)[0]?.market_ref ?? null;
  const yes = real.map((m) => m.yes_price).filter((p): p is number => p != null && p > 0 && p < 1);
  return {
    question: anchor.title,
    refs: rows.map((m) => m.market_ref),
    cheapest_yes: cheapest("yes_price"),
    cheapest_no: cheapest("no_price"),
    /** Largest YES price difference between real-money venues, in cents. */
    spread_cents: yes.length > 1 ? Math.round((Math.max(...yes) - Math.min(...yes)) * 100) : 0,
  };
}

// ---------------------------------------------------------------- Radar Pools (our NEAR testnet market)

const POOLS_CONTRACT = process.env.POOLS_CONTRACT || "pools.mradar-mwcw3x85.testnet";
interface PoolMarket { id: string; title: string; category: string; outcomes: string[]; pools: string[]; closes_at: string; status: string }

async function openPools(): Promise<PoolMarket[]> {
  try {
    const res = await fetch("https://rpc.testnet.fastnear.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({
        jsonrpc: "2.0", id: "mr", method: "query",
        params: {
          request_type: "call_function", finality: "optimistic", account_id: POOLS_CONTRACT, method_name: "get_markets",
          args_base64: Buffer.from(JSON.stringify({ from: 0, limit: 100 })).toString("base64"),
        },
      }),
    });
    const j = await res.json();
    const all = JSON.parse(Buffer.from(j.result.result).toString()) as PoolMarket[];
    return all.filter((m) => m.status === "Open" && m.category !== "flash");
  } catch {
    return [];
  }
}

const asMarket = (p: PoolMarket): Market => ({
  venue: "manifold", market_ref: `pool:${p.id}`, title: p.title, event_title: null, yes_price: null, no_price: null,
  volume: null, volume_unit: "USD", closes_at: null, url: "",
});

/** Our pools that ask the same question as the compared markets (or the top results). */
function matchPools(pools: PoolMarket[], against: Market[]) {
  return pools
    .filter((p) => against.some((m) => sameQuestion(m, asMarket(p)) || sameQuestion(asMarket(p), m)))
    .map((p) => ({ id: p.id, title: p.title, outcomes: p.outcomes, pools: p.pools, closes_at: p.closes_at }));
}

export async function search(query: string, limit = 12) {
  const topic = extractTopic(query);
  const [{ markets, venues }, pools] = await Promise.all([scout(topic), openPools()]);
  const perEvent = new Map<string, number>();
  const ranked = markets
    .sort((a, b) => score(topic, b) - score(topic, a))
    .filter((m) => {
      const key = `${m.venue}:${m.event_title ?? m.market_ref}`;
      perEvent.set(key, (perEvent.get(key) ?? 0) + 1);
      return perEvent.get(key)! <= 2;
    })
    // Markets with the user's own numbers and direction ("above 150k") come first.
    .sort((a, b) => Number(fitsQuery(topic, b)) - Number(fitsQuery(topic, a)))
    .slice(0, limit)
    .map((m) => ({ ...m, venue_name: VENUES[m.venue].name, trust: VENUES[m.venue].trust, match: Math.round(score(topic, m) * 100) / 100 }));
  const cmp = compare(ranked);
  const against = cmp ? ranked.filter((m) => cmp.refs.includes(m.market_ref)) : ranked.filter((m) => m.trust !== "play_money").slice(0, 3);
  return { query, topic, markets: ranked, compare: cmp, venues, pools: matchPools(pools, against) };
}

const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=30, s-maxage=30" },
  });

export async function GET(request: Request): Promise<Response> {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2 || q.length > 200) return json(400, { error: "Type at least 2 characters" });
  try {
    return json(200, await search(q));
  } catch (e) {
    return json(502, { error: String((e as Error)?.message ?? e).slice(0, 200) });
  }
}
