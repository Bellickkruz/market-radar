// Deploy Radar Pools on NEAR testnet and open the starter markets.
//
//   node deploy.mjs <funded-account-key.json> <keys-out-dir>
//
// Under the funded account it creates:  tusd.<acct> (test dollar), pools.<acct> (the
// market), ops.<acct> (operator: creates markets, posts results, relays signed bets).
// Each market is seeded with $100 of test money split by the odds on Kalshi/Polymarket
// at deploy time, so the first visitors see realistic prices instead of empty pools.
import { readFileSync, writeFileSync } from "node:fs";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";

const [keyFile, outDir] = process.argv.slice(2);
if (!keyFile || !outDir) throw new Error("usage: node deploy.mjs <funded-account-key.json> <keys-out-dir>");
const root = JSON.parse(readFileSync(keyFile, "utf8"));
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const rootAcct = new Account(root.account_id, provider, KeyPairSigner.fromSecretKey(root.private_key));
const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const D = 1_000_000n; // $1 in tUSD (6 decimals)

async function sub(name, near) {
  const id = `${name}.${root.account_id}`;
  const kp = KeyPair.fromRandom("ed25519");
  await rootAcct.createSubAccount({ accountOrPrefix: id, publicKey: kp.getPublicKey(), nearToTransfer: near });
  writeFileSync(`${outDir}/${id}.json`, JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
  console.log("created", id);
  return new Account(id, provider, KeyPairSigner.fromSecretKey(kp.toString()));
}

const token = await sub("tusd", 2n * NEAR);
await token.deployContract(readFileSync(new URL("../test-token/target/near/radar_test_usd.wasm", import.meta.url)));
await token.callFunction({ contractId: token.accountId, methodName: "new", args: {}, gas: 30n * TGAS });

const ops = await sub("ops", 2n * NEAR);
const pools = await sub("pools", 3n * NEAR);
await pools.deployContract(readFileSync(new URL("../pools/target/near/radar_pools.wasm", import.meta.url)));
await pools.callFunction({
  contractId: pools.accountId, methodName: "new", gas: 30n * TGAS,
  args: { owner: root.account_id, operator: ops.accountId, token: token.accountId },
});
for (const who of [pools.accountId, ops.accountId]) {
  await ops.callFunction({ contractId: token.accountId, methodName: "mint", args: { account_id: who, amount: "0" }, gas: 30n * TGAS });
}

const ns = (iso) => String(BigInt(Date.parse(iso)) * 1_000_000n);
// [title, category, outcomes, closes (UTC), seed odds in %]
const MARKETS = [
  ["Will Bitcoin be above $100,000 on December 31, 2026?", "crypto", ["Yes", "No"], "2026-12-31T23:59:00Z", [6, 94]],
  ["Will Bitcoin be above $75,000 on November 30, 2026?", "crypto", ["Yes", "No"], "2026-11-30T23:59:00Z", [45, 55]],
  ["Will Ethereum be above $2,000 on November 30, 2026?", "crypto", ["Yes", "No"], "2026-11-30T23:59:00Z", [55, 45]],
  ["Will Solana be above $100 on December 31, 2026?", "crypto", ["Yes", "No"], "2026-12-31T23:59:00Z", [25, 75]],
  ["Chelsea vs Leeds United (Premier League, Nov 21)", "football", ["Chelsea", "Draw", "Leeds United"], "2026-11-21T15:00:00Z", [52, 25, 23]],
  ["Real Madrid vs Celta Vigo (La Liga, Nov 21)", "football", ["Real Madrid", "Draw", "Celta Vigo"], "2026-11-21T20:00:00Z", [82, 11, 7]],
  ["Liverpool vs Manchester United (Premier League, Nov 22)", "football", ["Liverpool", "Draw", "Manchester United"], "2026-11-22T16:30:00Z", [56, 22, 22]],
];

// The operator funds its own balance in the pools, then seeds each market.
await ops.callFunction({ contractId: token.accountId, methodName: "mint", args: { account_id: ops.accountId, amount: String(1000n * D) }, gas: 30n * TGAS });
await ops.callFunction({
  contractId: token.accountId, methodName: "ft_transfer_call", deposit: 1n, gas: 100n * TGAS,
  args: { receiver_id: pools.accountId, amount: String(1000n * D), msg: JSON.stringify({ owner: ops.accountId }) },
});
for (const [title, category, outcomes, closes, odds] of MARKETS) {
  const id = String(await ops.callFunction({
    contractId: pools.accountId, methodName: "create_market", gas: 30n * TGAS,
    args: { title, category, outcomes, closes_at: ns(closes) },
  }));
  for (const [i, pct] of odds.entries()) {
    await ops.callFunction({ contractId: pools.accountId, methodName: "bet", gas: 30n * TGAS, args: { market_id: id, outcome: i, amount: String(BigInt(pct) * D) } });
  }
  console.log(`market #${id}: ${title} (seeded ${odds.join("/")})`);
}
console.log(`\nPOOLS_CONTRACT=${pools.accountId}\nPOOLS_TOKEN=${token.accountId}\nOPS_ACCOUNT_ID=${ops.accountId}`);
