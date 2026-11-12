// What it costs to move money onto each venue, as a share of the amount: a live NEAR Intents
// (1Click) price-only quote for $100 of USDC delivered to the venue's deposit network, paid with
// USDC on NEAR. It includes every swap and bridge fee, plus Market Radar's own funding fee, so the
// "net gap" counts exactly what a Market Radar user would pay to get there.
import type { Venue } from "./_venues.js";

const API = "https://1click.chaindefuser.com/v0/quote";
const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const FEE_RECIPIENT = process.env.APP_FEE_RECIPIENT || "bellickkruz.near";
const FEE_BPS = Number(process.env.APP_FEE_BPS ?? 50);

/** Each real-money venue's usual USDC deposit network (Kalshi takes several; Solana is the cheapest route). */
const ROUTE: Partial<Record<Venue, { asset: string; sample: string; chain: string }>> = {
  polymarket: { chain: "Polygon", asset: "nep141:pol-0x3c499c542cef5e3811e1192ce70d8cc03d5c3359.omdep.near", sample: "0x52908400098527886E0F7030069857D2E4169EE7" },
  limitless: { chain: "Base", asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", sample: "0x52908400098527886E0F7030069857D2E4169EE7" },
  kalshi: { chain: "Solana", asset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", sample: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" },
};

export const FUND_AMOUNT = 100;
const TTL = 10 * 60_000;
let cache: { at: number; pct: Partial<Record<Venue, number>> } | null = null;

async function quotePct(venue: Venue): Promise<number | null> {
  const r = ROUTE[venue];
  if (!r) return null;
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(3500),
      body: JSON.stringify({
        dry: true, swapType: "EXACT_OUTPUT", slippageTolerance: 100,
        originAsset: USDC_NEAR, depositType: "ORIGIN_CHAIN",
        destinationAsset: r.asset, amount: String(FUND_AMOUNT * 1_000_000),
        recipient: r.sample, recipientType: "DESTINATION_CHAIN",
        refundTo: "intents.near", refundType: "ORIGIN_CHAIN",
        deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
        referral: "market-radar",
        ...(FEE_BPS > 0 ? { appFees: [{ recipient: FEE_RECIPIENT, fee: FEE_BPS }] } : {}),
      }),
    });
    const j = await res.json();
    const paid = Number(j?.quote?.amountInUsd ?? j?.quote?.amountInFormatted);
    return Number.isFinite(paid) && paid > 0 ? Math.max(0, paid - FUND_AMOUNT) / FUND_AMOUNT : null;
  } catch {
    return null;
  }
}

/** Funding cost per venue as a fraction (0.0133 = 1.33%), cached for 10 minutes. Missing = unknown. */
export async function fundingCosts(): Promise<Partial<Record<Venue, number>>> {
  if (cache && Date.now() - cache.at < TTL) return cache.pct;
  const venues = Object.keys(ROUTE) as Venue[];
  const got = await Promise.all(venues.map(quotePct));
  const pct: Partial<Record<Venue, number>> = {};
  venues.forEach((v, i) => { if (got[i] != null) pct[v] = got[i]!; });
  if (Object.keys(pct).length) cache = { at: Date.now(), pct };
  return pct;
}

export const FUND_CHAIN: Partial<Record<Venue, string>> = Object.fromEntries(Object.entries(ROUTE).map(([v, r]) => [v, r!.chain]));
