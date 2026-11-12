import { useCallback, useEffect, useState } from "react";
import {
  EXPLORER, POOLS_CONTRACT, closesMs, dollars, fmt, multiple, placeBet, player, relay, share, total, view,
  type PoolMarket, type Position,
} from "./lib/pools";

const STAKES = [5, 10, 25];

function until(ms: number) {
  const s = Math.max(0, Math.round((ms - Date.now()) / 1000));
  if (s >= 86_400) return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Radar Pools: our own pool-betting prediction market on NEAR testnet. */
export function Pools({ focus }: { focus?: string }) {
  const me = player();
  const [markets, setMarkets] = useState<PoolMarket[] | null>(null);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [balance, setBalance] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [, tick] = useState(0);

  const say = (t: string) => { setToast(t); setTimeout(() => setToast(""), 3500); };

  const load = useCallback(async () => {
    try {
      const [ms, bal, mine] = await Promise.all([
        view<PoolMarket[]>("get_markets", { from: 0, limit: 100 }),
        view<string>("get_balance", { owner: me.id }),
        view<number[]>("get_owner_markets", { owner: me.id }),
      ]);
      const pos = await Promise.all(mine.map((id) => view<Position | null>("get_position", { market_id: String(id), owner: me.id })));
      const map: Record<string, Position> = {};
      mine.forEach((id, i) => { if (pos[i]) map[String(id)] = pos[i]!; });
      setMarkets(ms);
      setPositions(map);
      setBalance(dollars(bal));
      // Collect winnings automatically once a market is settled.
      for (const m of ms) {
        const p = map[m.id];
        if (p && !p.claimed && m.status !== "Open") relay({ method: "claim", owner: me.id, market_id: m.id }).catch(() => {});
      }
    } catch {
      /* keep the last state on a network blip */
    }
  }, [me.id]);

  // Settle finished quick rounds and open a new one, then keep the page fresh.
  useEffect(() => {
    relay({ method: "flash" }).catch(() => {}).finally(load);
    const a = setInterval(load, 5000);
    const b = setInterval(() => relay({ method: "flash" }).then((r) => (r.settled?.length || r.created) && load()).catch(() => {}), 20_000);
    const c = setInterval(() => tick((x) => x + 1), 1000);
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); };
  }, [load]);

  useEffect(() => {
    if (focus && markets) document.getElementById(`pool-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus, markets]);

  const [funding, setFunding] = useState(false);
  const getDollars = async () => {
    setFunding(true);
    try {
      await relay({ method: "faucet", owner: me.id });
      say("$100 test dollars added");
      load();
    } catch (e) {
      say(String((e as Error).message));
    } finally {
      setFunding(false);
    }
  };

  const open = (markets ?? []).filter((m) => m.status === "Open" && m.category !== "flash");
  const flash = (markets ?? []).filter((m) => m.category === "flash").sort((a, b) => Number(b.id) - Number(a.id));
  const currentFlash = flash.find((m) => m.status === "Open");
  const lastFlash = flash.filter((m) => m.status !== "Open").slice(0, 3);
  const settled = (markets ?? []).filter((m) => m.status !== "Open" && m.category !== "flash");

  return (
    <>
      <section className="hero">
        <h1>Radar Pools <span className="accent">on NEAR</span></h1>
        <p className="lead">
          Our own prediction market, running as a smart contract on the NEAR blockchain. Back an outcome; when the result is in,
          everyone who backed the winner splits the whole pot. Crypto prices and football, plus a 2-minute Bitcoin round.
        </p>
        <div className="testnet-banner">🧪 <b>NEAR testnet · test money only.</b> Real-money betting needs licences, so this runs on testnet. <a href={`${EXPLORER}${POOLS_CONTRACT}`} target="_blank" rel="noreferrer">See the contract ↗</a></div>
      </section>

      <div className="card wallet">
        <div>
          <span className="muted small">Your test balance</span>
          <div className="big-amt">{balance == null ? "…" : fmt(balance)}</div>
          <span className="muted small">No wallet needed: your browser holds your player key.</span>
        </div>
        {balance != null && balance < 10 && (
          <button className="btn" disabled={funding} onClick={getDollars}>{funding ? <span className="spinner" /> : "Get $100 test dollars"}</button>
        )}
      </div>

      {!markets && <div className="card center"><span className="spinner dark" /></div>}

      {currentFlash && (
        <>
          <h3 className="section-title">⚡ Quick round</h3>
          <MarketCard m={currentFlash} pos={positions[currentFlash.id]} balance={balance ?? 0} onDone={load} say={say} flash />
        </>
      )}
      {lastFlash.length > 0 && (
        <div className="card soft small">
          <b>Last rounds</b>
          {lastFlash.map((m) => (
            <div key={m.id} className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
              <span className="muted">{m.resolution ?? "Cancelled: nobody backed the winner"}</span>
              {positions[m.id] && <MyResult m={m} pos={positions[m.id]} />}
            </div>
          ))}
        </div>
      )}

      {open.length > 0 && <h3 className="section-title">Open markets</h3>}
      {open.map((m) => <MarketCard key={m.id} m={m} pos={positions[m.id]} balance={balance ?? 0} onDone={load} say={say} highlight={m.id === focus} />)}

      {settled.length > 0 && <h3 className="section-title">Settled</h3>}
      {settled.map((m) => <MarketCard key={m.id} m={m} pos={positions[m.id]} balance={balance ?? 0} onDone={load} say={say} />)}

      <section className="card soft small">
        <b>How Radar Pools works</b>
        <ul className="muted">
          <li>Each outcome has its own pool. Its share of the pot is its price: 62% means the crowd puts it at about 62%.</li>
          <li>When the result is in, the winning pool's backers split the whole pot by stake. No order book, no market maker.</li>
          <li>Pools open seeded with $100 of test money split by the odds on Kalshi and Polymarket, so prices start realistic.</li>
          <li>Results are posted by a named resolver account with the source (Coinbase prices, official match results). If nobody backed the winner, everyone is refunded.</li>
          <li>On mainnet, deposits would arrive from any coin through NEAR Intents, the same way Market Radar funds other venues.</li>
        </ul>
      </section>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function MyResult({ m, pos }: { m: PoolMarket; pos: Position }) {
  const staked = pos.stakes.reduce((s, x) => s + dollars(x), 0);
  if (m.status === "Cancelled") return <span className="small">↩️ {fmt(staked)} refunded</span>;
  const w = m.winner ?? 0;
  const won = dollars(pos.stakes[w]) > 0 ? (dollars(pos.stakes[w]) * total(m)) / dollars(m.pools[w]) : 0;
  return won > 0 ? <span className="small win">🎉 won {fmt(won)}</span> : <span className="small muted">lost {fmt(staked)}</span>;
}

function MarketCard({ m, pos, balance, onDone, say, flash = false, highlight = false }: {
  m: PoolMarket; pos?: Position; balance: number; onDone: () => void; say: (t: string) => void; flash?: boolean; highlight?: boolean;
}) {
  const [pick, setPick] = useState<number | null>(null);
  const [stake, setStake] = useState(10);
  const [busy, setBusy] = useState(false);
  const closes = closesMs(m);
  const isOpen = m.status === "Open" && Date.now() < closes;
  const settling = m.status === "Open" && Date.now() >= closes;

  const go = async () => {
    if (pick == null) return;
    setBusy(true);
    try {
      await placeBet(m.id, pick, stake);
      say(`Bet placed: ${fmt(stake)} on ${m.outcomes[pick]}`);
      setPick(null);
      onDone();
      setTimeout(onDone, 2500);
    } catch (e) {
      say(`Didn't go through: ${String((e as Error).message)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article id={`pool-${m.id}`} className={`card pool ${flash ? "flash" : ""} ${highlight ? "open" : ""}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="venue v-radar">{m.category === "flash" ? "⚡ 2-minute round" : m.category === "football" ? "⚽ Football" : "₿ Crypto"}</span>
        <span className="muted small">
          {isOpen ? `closes in ${until(closes)}` : settling ? "Closed · settling…" : m.status === "Cancelled" ? "Cancelled · refunded" : "Settled"}
          {" · "}{fmt(total(m))} pot · {m.bettors} {m.bettors === 1 ? "bettor" : "bettors"}
        </span>
      </div>
      <h3 className="mtitle">{m.title}</h3>
      <div className={`outcomes n${m.outcomes.length}`}>
        {m.outcomes.map((o, i) => {
          const mine = pos ? dollars(pos.stakes[i]) : 0;
          const won = m.status === "Resolved" && m.winner === i;
          return (
            <button key={o} className={`outcome ${pick === i ? "on" : ""} ${won ? "won" : ""}`} disabled={!isOpen} onClick={() => setPick(pick === i ? null : i)}>
              <span className="oname">{won && "✅ "}{o}</span>
              <b>{Math.round(share(m, i) * 100)}%</b>
              <span className="small muted">{isOpen ? `pays ×${multiple(m, i, stake).toFixed(2)}` : fmt(dollars(m.pools[i]))}</span>
              {mine > 0 && <em>you: {fmt(mine)}</em>}
            </button>
          );
        })}
      </div>
      {isOpen && pick != null && (
        <div className="betbar">
          <div className="chips">
            {STAKES.map((s) => <button key={s} className={`chip ${stake === s ? "on" : ""}`} onClick={() => setStake(s)}>${s}</button>)}
          </div>
          <button className="btn" disabled={busy || balance < stake} onClick={go}>
            {busy ? <span className="spinner" /> : `Bet ${fmt(stake)} on ${m.outcomes[pick]}`}
          </button>
          <p className="hint" style={{ width: "100%" }}>
            {balance < stake ? "Get test dollars first (top of the page)." : `If ${m.outcomes[pick]} wins, about ${fmt(stake * multiple(m, pick, stake))} back, depending on later bets.`}
          </p>
        </div>
      )}
      {m.status !== "Open" && (
        <p className="small" style={{ margin: "8px 0 0" }}>
          {m.resolution}
          {m.source && <> · <a href={m.source} target="_blank" rel="noreferrer">source ↗</a></>}
          {pos && <> · <MyResult m={m} pos={pos} /></>}
        </p>
      )}
      {settling && <p className="hint">Waiting for the closing price, then winnings are paid automatically.</p>}
    </article>
  );
}
