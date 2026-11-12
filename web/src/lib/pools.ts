// Radar Pools client (NEAR testnet). The player is an ed25519 key kept in this browser;
// bets are signed here and submitted by the relay (/api/pools), which pays the gas.
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";

export const POOLS_CONTRACT = "pools.mradar-mwcw3x85.testnet";
export const EXPLORER = "https://testnet.nearblocks.io/address/";
const RPC = "https://rpc.testnet.fastnear.com";
const KEY = "mr:pools:secret";
export const D = 1_000_000;

export interface PoolMarket {
  id: string;
  title: string;
  category: "crypto" | "football" | "flash" | string;
  outcomes: string[];
  closes_at: string;
  status: "Open" | "Resolved" | "Cancelled";
  pools: string[];
  bettors: number;
  winner: number | null;
  resolution: string | null;
  source: string | null;
}
export interface Position {
  stakes: string[];
  claimed: boolean;
}

export async function view<T>(method: string, args: object = {}): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "mr", method: "query",
      params: { request_type: "call_function", finality: "optimistic", account_id: POOLS_CONTRACT, method_name: method, args_base64: btoa(JSON.stringify(args)) },
    }),
  });
  const j = await res.json();
  if (j.error || j.result?.error) throw new Error(JSON.stringify(j.error ?? j.result.error).slice(0, 200));
  return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result))) as T;
}

/** This browser's player key (made on first use). */
export function player(): { secret: Uint8Array; id: string } {
  let hex: string | null = null;
  try {
    hex = localStorage.getItem(KEY);
  } catch {
    /* private mode: a fresh player each visit */
  }
  let secret: Uint8Array;
  if (hex && /^[0-9a-f]{64}$/.test(hex)) {
    secret = Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
  } else {
    secret = ed25519.utils.randomPrivateKey();
    try {
      localStorage.setItem(KEY, [...secret].map((b) => b.toString(16).padStart(2, "0")).join(""));
    } catch {
      /* not remembered */
    }
  }
  return { secret, id: `ed25519:${bs58.encode(ed25519.getPublicKey(secret))}` };
}

export async function relay(body: object): Promise<any> {
  const res = await fetch("/api/pools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`);
  return j;
}

export async function placeBet(marketId: string, outcome: number, dollars: number) {
  const me = player();
  const action = { type: "bet", market_id: marketId, outcome, amount: String(Math.round(dollars * D)) };
  const message = await view<string>("action_message", { owner: me.id, action });
  const signature = bs58.encode(ed25519.sign(new TextEncoder().encode(message), me.secret));
  return relay({ method: "bet", owner: me.id, action, signature });
}

export const dollars = (units: string | number) => Number(units) / D;
export const fmt = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
export const total = (m: PoolMarket) => m.pools.reduce((s, p) => s + dollars(p), 0);
/** An outcome's share of the pot, which is its implied chance. */
export const share = (m: PoolMarket, i: number) => (total(m) ? dollars(m.pools[i]) / total(m) : 0);
/** What $1 on outcome i would pay back if it won, with the pools as they stand (after adding the $1). */
export const multiple = (m: PoolMarket, i: number, stake = 1) => (total(m) + stake) / (dollars(m.pools[i]) + stake);
export const closesMs = (m: PoolMarket) => Number(BigInt(m.closes_at) / 1_000_000n);
