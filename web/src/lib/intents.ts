// Funding a prediction-market account from any coin, through NEAR Intents 1Click.
// The user's own venue deposit address is the recipient, so the money goes straight
// from the user's wallet to their venue account: Market Radar never holds it.
// 1Click docs: https://docs.near-intents.org/near-intents/integration/distribution-channels/1click-api

const API = "https://1click.chaindefuser.com/v0";

export type Chain = "Polygon" | "Base" | "Solana" | "Ethereum" | "Arbitrum" | "Tron" | "Bitcoin" | "NEAR";

/** USDC delivered on each chain a venue may take deposits on. All 6 decimals. */
export const USDC_ON: Partial<Record<Chain, string>> = {
  Polygon: "nep141:pol-0x3c499c542cef5e3811e1192ce70d8cc03d5c3359.omdep.near", // native USDC
  Base: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  Solana: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
  Ethereum: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
  Arbitrum: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
};

export const USDC_CONTRACT: Partial<Record<Chain, string>> = {
  Polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  Base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  Solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  Ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  Arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};

export interface Destination {
  venue: "polymarket" | "kalshi" | "limitless";
  name: string;
  /** Networks the venue's deposit screen may show for USDC; the user confirms which. */
  chains: Chain[];
  howTo: string;
  url: string;
}

// Sources checked on 2026-11-12. Venues change deposit options, so the user always
// confirms against their own deposit screen before payment details are shown.
export const DESTINATIONS: Record<Destination["venue"], Destination> = {
  polymarket: {
    venue: "polymarket", name: "Polymarket", chains: ["Polygon"],
    howTo: "In Polymarket, tap Deposit, choose USDC on Polygon, and copy the address it shows.",
    url: "https://polymarket.com",
  },
  limitless: {
    venue: "limitless", name: "Limitless", chains: ["Base"],
    howTo: "In Limitless, open your wallet, choose Deposit, and copy your Base address (native USDC on Base).",
    url: "https://limitless.exchange",
  },
  kalshi: {
    venue: "kalshi", name: "Kalshi", chains: ["Solana", "Base", "Ethereum", "Polygon", "Arbitrum"],
    howTo: "In Kalshi, choose Deposit, then Crypto, then USDC, pick a network, and copy the address. Choose the same network here.",
    url: "https://kalshi.com",
  },
};

export interface Origin {
  assetId: string;
  label: string;
  chain: Chain;
  addressHint: string;
}

/** Coins people commonly hold, the NEAR ones first. */
export const ORIGINS: Origin[] = [
  { assetId: "nep141:wrap.near", label: "NEAR", chain: "NEAR", addressHint: "you.near" },
  { assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", label: "USDC", chain: "NEAR", addressHint: "you.near" },
  { assetId: "nep141:eth.omft.near", label: "ETH", chain: "Ethereum", addressHint: "0x…" },
  { assetId: "nep141:base.omft.near", label: "ETH", chain: "Base", addressHint: "0x…" },
  { assetId: "nep141:sol.omft.near", label: "SOL", chain: "Solana", addressHint: "Solana address" },
  { assetId: "nep141:btc.omft.near", label: "BTC", chain: "Bitcoin", addressHint: "bc1…" },
  { assetId: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", label: "USDT", chain: "Tron", addressHint: "T…" },
  { assetId: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", label: "USDT", chain: "Ethereum", addressHint: "0x…" },
  { assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", label: "USDC", chain: "Base", addressHint: "0x…" },
  { assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", label: "USDC", chain: "Arbitrum", addressHint: "0x…" },
];

/** Does `addr` look like an address on `chain`? Catches paste mistakes; 1Click validates too. */
export function looksLikeAddress(chain: Chain, addr: string): boolean {
  const a = addr.trim();
  if (["Polygon", "Base", "Ethereum", "Arbitrum"].includes(chain)) return /^0x[0-9a-fA-F]{40}$/.test(a);
  if (chain === "Solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  if (chain === "Tron") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
  if (chain === "Bitcoin") return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a);
  if (chain === "NEAR") return /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(a) && a.length >= 2 && a.length <= 64;
  return false;
}

/** Valid placeholder addresses, only for price-only ("dry") quotes. */
const SAMPLE: Record<Chain, string> = {
  Polygon: "0x52908400098527886E0F7030069857D2E4169EE7",
  Base: "0x52908400098527886E0F7030069857D2E4169EE7",
  Ethereum: "0x52908400098527886E0F7030069857D2E4169EE7",
  Arbitrum: "0x52908400098527886E0F7030069857D2E4169EE7",
  Solana: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  Tron: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  Bitcoin: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  NEAR: "intents.near",
};

export interface Quote {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd?: string;
  amountOutFormatted: string;
  timeEstimate?: number;
  deadline?: string;
}

/**
 * Ask 1Click for exactly `usdc` dollars of USDC delivered to `recipient` on `chain`, paid in
 * `origin`. With `dry`, it's a price only (no deposit address, nothing can be sent).
 */
export async function quote(p: {
  origin: Origin; chain: Chain; usdc: number; recipient?: string; refundTo?: string; dry: boolean;
}): Promise<Quote> {
  const destination = USDC_ON[p.chain];
  if (!destination) throw new Error(`USDC on ${p.chain} isn't supported`);
  const res = await fetch(`${API}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dry: p.dry,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      originAsset: p.origin.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: destination,
      amount: String(Math.round(p.usdc * 1_000_000)),
      recipient: p.recipient?.trim() || SAMPLE[p.chain],
      recipientType: "DESTINATION_CHAIN",
      refundTo: p.refundTo?.trim() || SAMPLE[p.origin.chain],
      refundType: "ORIGIN_CHAIN",
      deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
      referral: "market-radar",
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.quote) throw new Error(friendlyError(json.message ?? `Quote failed (${res.status})`));
  return json.quote as Quote;
}

function friendlyError(msg: string): string {
  if (/minimum swap amount is \$?(\d+)/i.test(msg)) return `This route needs at least $${msg.match(/minimum swap amount is \$?(\d+)/i)![1]} right now. Raise the amount or pay with another coin.`;
  if (/recipient is not valid/i.test(msg)) return "That deposit address isn't valid for this network. Copy it again from your venue's deposit screen.";
  if (/refundTo is not valid/i.test(msg)) return "Your refund address isn't valid for the coin you're paying with.";
  return msg;
}

export type SwapStatus = "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "PROCESSING" | "SUCCESS" | "INCOMPLETE_DEPOSIT" | "REFUNDED" | "FAILED";

export async function swapStatus(depositAddress: string, memo?: string): Promise<{ status: SwapStatus; hashes: string[] }> {
  const q = new URLSearchParams({ depositAddress, ...(memo ? { depositMemo: memo } : {}) });
  const res = await fetch(`${API}/status?${q}`);
  const json = await res.json();
  const hashes = (json.swapDetails?.destinationChainTxHashes ?? []).map((h: { hash: string }) => h.hash);
  return { status: json.status as SwapStatus, hashes };
}

/** 0.121674759 -> "0.1217"; 252.547999 -> "252.55" */
export function friendlyAmount(formatted: string): string {
  const n = Number(formatted);
  if (!isFinite(n)) return formatted;
  if (n >= 100) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return Number(n.toPrecision(4)).toString();
}
