// GET /api/board : the "price gaps right now" overview. Runs a handful of popular
// questions through the same search + same-question comparison as /api/scout, and
// returns one compact row per question that more than one venue lists.
import { search } from "./scout.js";

const QUESTIONS = [
  "bitcoin 100k",
  "bitcoin above 150k",
  "solana 200",
  "Nigeria election 2027",
  "Arsenal",
  "Real Madrid",
  "Barcelona champions league",
  "Manchester City",
];

type VenueId = "polymarket" | "kalshi" | "limitless" | "manifold";

export async function board() {
  const results = await Promise.allSettled(QUESTIONS.map((q) => search(q)));
  const rows = results.flatMap((r, i) => {
    if (r.status !== "fulfilled" || !r.value.compare) return [];
    const { compare, markets, pools } = r.value;
    const byRef = new Map(markets.map((m) => [m.market_ref, m]));
    const venues: Partial<Record<VenueId, { yes: number | null; no: number | null; url: string; ref: string }>> = {};
    for (const ref of compare.refs) {
      const m = byRef.get(ref);
      if (m) venues[m.venue] = { yes: m.yes_price, no: m.no_price, url: m.url, ref };
    }
    const cheapest = compare.cheapest_yes ? byRef.get(compare.cheapest_yes)?.venue ?? null : null;
    // Polymarket words questions most plainly; Kalshi appends the outcome ("… — Arsenal").
    const poly = venues.polymarket ? byRef.get(venues.polymarket.ref)?.title : null;
    const question = (poly ?? compare.question).split(" — ")[0]!;
    return [{ query: QUESTIONS[i]!, question, venues, cheapest_yes: cheapest, gap_cents: compare.spread_cents, net_gap_cents: compare.net_gap_cents, pool: pools[0]?.id ?? null }];
  });
  rows.sort((a, b) => b.gap_cents - a.gap_cents);
  return { updated: new Date().toISOString(), rows };
}

export async function GET(): Promise<Response> {
  try {
    return new Response(JSON.stringify(await board()), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=60, s-maxage=120, stale-while-revalidate=600" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e).slice(0, 200) }), { status: 502, headers: { "content-type": "application/json" } });
  }
}
