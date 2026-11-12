// Radar Pools relay (Vercel function, NEAR testnet). Players have no NEAR account: their
// browser holds an ed25519 key and signs each bet. This relay pays the gas, hands out
// free test dollars, and runs the "Bitcoin in 2 minutes" quick round. It can't move
// anyone's money: bets need the player's signature (checked here and by the contract),
// and payouts only ever go to the position's owner.
//
// Env: OPS_ACCOUNT_ID, OPS_PRIVATE_KEY (the pools operator), optional POOLS_CONTRACT, POOLS_TOKEN.
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";

export const POOLS_CONTRACT = process.env.POOLS_CONTRACT || "pools.mradar-mwcw3x85.testnet";
export const POOLS_TOKEN = process.env.POOLS_TOKEN || "tusd.mradar-mwcw3x85.testnet";
const RPC = "https://rpc.testnet.fastnear.com";
const TGAS = 1_000_000_000_000n;
const D = 1_000_000n;
const FAST = "EXECUTED_OPTIMISTIC" as const;
const FLASH_MINUTES = 2;

interface Market {
  id: string;
  title: string;
  category: string;
  outcomes: string[];
  closes_at: string;
  status: "Open" | "Resolved" | "Cancelled";
  pools: string[];
}

const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const errText = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0].slice(0, 300);

const provider = () => new JsonRpcProvider({ url: RPC });
function ops() {
  const id = process.env.OPS_ACCOUNT_ID, key = process.env.OPS_PRIVATE_KEY;
  if (!id || !key) throw new Error("Relay is not configured (OPS_ACCOUNT_ID / OPS_PRIVATE_KEY)");
  return new Account(id, provider(), KeyPairSigner.fromSecretKey(key as `ed25519:${string}`));
}
const view = <T>(method: string, args: Record<string, unknown> = {}) =>
  provider().callFunction({ contractId: POOLS_CONTRACT, method, args }) as Promise<T>;
const call = (methodName: string, args: Record<string, unknown>, gas = 50n) =>
  ops().callFunction({ contractId: POOLS_CONTRACT, methodName, args, gas: gas * TGAS, waitUntil: FAST });

function isKey(owner: unknown): owner is string {
  if (typeof owner !== "string" || !owner.startsWith("ed25519:")) return false;
  try {
    return bs58.decode(owner.slice(8)).length === 32;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- free test dollars

async function faucet(owner: string) {
  const balance = BigInt(await view<string>("get_balance", { owner }));
  if (balance >= 10n * D) return json(200, { ok: true, skipped: "You still have test dollars" });
  const o = ops();
  await o.callFunction({ contractId: POOLS_TOKEN, methodName: "mint", args: { account_id: o.accountId, amount: String(100n * D) }, gas: 30n * TGAS, waitUntil: FAST });
  await o.callFunction({
    contractId: POOLS_TOKEN, methodName: "ft_transfer_call", deposit: 1n, gas: 100n * TGAS, waitUntil: FAST,
    args: { receiver_id: POOLS_CONTRACT, amount: String(100n * D), msg: JSON.stringify({ owner }) },
  });
  return json(200, { ok: true });
}

// ---------------------------------------------------------------- signed bets and payouts

async function bet(owner: string, action: unknown, signature: unknown) {
  const a = action as { type?: string; market_id?: string; outcome?: number; amount?: string };
  if (a?.type !== "bet" || typeof signature !== "string" || !/^\d+$/.test(String(a.market_id)) || !/^\d+$/.test(String(a.amount))) {
    return json(400, { error: "Bad bet" });
  }
  // Check the signature here first, so junk can't burn the relayer's gas.
  const message = await view<string>("action_message", { owner, action });
  let ok = false;
  try {
    ok = ed25519.verify(bs58.decode(signature), new TextEncoder().encode(message), bs58.decode(owner.slice(8)));
  } catch {
    ok = false;
  }
  if (!ok) return json(401, { error: "Signature doesn't match this player" });
  await call("bet_signed", { owner, action, signature });
  return json(200, { ok: true });
}

async function claim(owner: string, marketId: string) {
  if (!/^\d+$/.test(marketId)) return json(400, { error: "Bad market" });
  const payout = await call("claim", { market_id: marketId, owner });
  return json(200, { payout: String(payout) });
}

// ---------------------------------------------------------------- "Bitcoin in 2 minutes"

const FLASH_PREFIX = "Bitcoin in 2 minutes: above $";

async function spotBtc(): Promise<number> {
  const r = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot", { headers: { "user-agent": "market-radar" } });
  return Number((await r.json()).data.amount);
}

/** Coinbase's BTC-USD price at the close of the 1-minute candle ending at `closeMs`, if published yet. */
async function btcAt(closeMs: number): Promise<number | null> {
  const start = new Date(closeMs - 60_000).toISOString(), end = new Date(closeMs).toISOString();
  const r = await fetch(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&start=${start}&end=${end}`, {
    headers: { "user-agent": "market-radar" },
  });
  if (!r.ok) return null;
  const candles = (await r.json()) as number[][]; // [time, low, high, open, close, volume]
  const c = candles.find((x) => x[0] * 1000 === closeMs - 60_000);
  return c ? c[4] : null;
}

const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Settle quick rounds that have closed, and open a new one when none is running. */
async function flash() {
  const markets = await view<Market[]>("get_markets", { from: 0, limit: 100 });
  const now = Date.now();
  const rounds = markets.filter((m) => m.category === "flash");
  const settled: string[] = [];
  for (const m of rounds.filter((r) => r.status === "Open" && Number(BigInt(r.closes_at) / 1_000_000n) <= now)) {
    const closeMs = Number(BigInt(m.closes_at) / 1_000_000n);
    const price = await btcAt(closeMs);
    if (price == null) continue; // not published yet; the next poll settles it
    const threshold = Number(m.title.slice(FLASH_PREFIX.length).replace(/[,?]/g, "").split(" ")[0]);
    const winner = price > threshold ? 0 : 1;
    const at = new Date(closeMs).toISOString().slice(11, 16);
    await call("resolve", {
      market_id: m.id, winner,
      resolution: `Coinbase BTC-USD price at ${at} UTC: ${fmtUsd(price)} (${winner === 0 ? "above" : "not above"} ${fmtUsd(threshold)})`,
      source: `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&start=${new Date(closeMs - 60_000).toISOString()}&end=${new Date(closeMs).toISOString()}`,
    });
    settled.push(m.id);
  }
  const running = rounds.some((r) => r.status === "Open" && Number(BigInt(r.closes_at) / 1_000_000n) > now + 30_000);
  let created: string | null = null;
  if (!running) {
    const price = await spotBtc();
    // Close on a whole minute, so the result is one public 1-minute candle.
    const closeMs = (Math.floor(now / 60_000) + FLASH_MINUTES + 1) * 60_000;
    created = String(await call("create_market", {
      title: `${FLASH_PREFIX}${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} at ${new Date(closeMs).toISOString().slice(11, 16)} UTC?`,
      category: "flash",
      outcomes: ["Higher", "Not higher"],
      closes_at: String(BigInt(closeMs) * 1_000_000n),
    }));
    // Seed both sides so the first player sees a real price.
    for (const outcome of [0, 1]) await call("bet", { market_id: created, outcome, amount: String(10n * D) }, 30n);
  }
  return json(200, { settled, created });
}

// ---------------------------------------------------------------- entry

export async function handlePools(body: any): Promise<Response> {
  try {
    switch (body?.method) {
      case "faucet":
        return isKey(body.owner) ? await faucet(body.owner) : json(400, { error: "Bad player key" });
      case "bet":
        return isKey(body.owner) ? await bet(body.owner, body.action, body.signature) : json(400, { error: "Bad player key" });
      case "claim":
        return isKey(body.owner) ? await claim(body.owner, String(body.market_id ?? "")) : json(400, { error: "Bad player key" });
      case "flash":
        return await flash();
      default:
        return json(400, { error: "Unknown method" });
    }
  } catch (e) {
    return json(422, { error: errText(e) });
  }
}

export async function POST(request: Request): Promise<Response> {
  return handlePools(await request.json().catch(() => null));
}
