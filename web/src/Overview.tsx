import { useEffect, useRef, useState, type ReactNode } from "react";
import { ORIGINS, friendlyAmount, quote } from "./lib/intents";
import { closesMs, relay, share, view, type PoolMarket } from "./lib/pools";

type VenueId = "polymarket" | "kalshi" | "limitless" | "manifold";
interface BoardRow {
  query: string;
  question: string;
  venues: Partial<Record<VenueId, { yes: number | null; no: number | null; url: string; ref: string }>>;
  cheapest_yes: VenueId | null;
  gap_cents: number;
  /** The gap left after each venue's trading fee and the cost of moving USDC there. */
  net_gap_cents?: number | null;
  pool: string | null;
}

const VENUE_COLS: { id: VenueId; name: string }[] = [
  { id: "polymarket", name: "Polymarket" },
  { id: "kalshi", name: "Kalshi" },
  { id: "limitless", name: "Limitless" },
  { id: "manifold", name: "Manifold" },
];
const cents = (p: number | null | undefined) => (p == null ? "–" : `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}¢`);

/** A number that briefly glows green or red when it changes. */
function Flash({ value, children }: { value: number | null | undefined; children: ReactNode }) {
  const prev = useRef(value);
  const [dir, setDir] = useState<"" | "up" | "down">("");
  useEffect(() => {
    if (prev.current != null && value != null && value !== prev.current) {
      setDir(value > prev.current ? "up" : "down");
      const t = setTimeout(() => setDir(""), 1400);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  return <span className={`flash ${dir}`}>{children}</span>;
}

// ---------------------------------------------------------------- radar

const BLIPS = [
  { name: "Polymarket", a: 38, r: 0.72 },
  { name: "Kalshi", a: 118, r: 0.5 },
  { name: "Radar Pools", a: 186, r: 0.82, near: true },
  { name: "Limitless", a: 248, r: 0.62 },
  { name: "Manifold", a: 318, r: 0.42 },
];

/** A tilted radar dish whose sweep lights up each venue as it passes. */
export function Radar() {
  return (
    <div className="radar-stage" aria-hidden="true">
      <div className="radar">
        <div className="radar-rings" />
        <div className="radar-sweep" />
        {BLIPS.map((b) => {
          const rad = (b.a * Math.PI) / 180;
          return (
            <div key={b.name} className={`blip ${b.near ? "near" : ""}`}
              style={{ left: `${50 + b.r * 50 * Math.sin(rad)}%`, top: `${50 - b.r * 50 * Math.cos(rad)}%`, ["--delay" as string]: `${(b.a / 360) * 4}s` }}>
              <span className="blip-dot" />
              <span className="blip-pin" />
              <span className="blip-label">{b.name}</span>
            </div>
          );
        })}
        <div className="radar-core" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- price-gap board

export function Board({ onOpen }: { onOpen: (query: string, fundCheapest: boolean) => void }) {
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [updated, setUpdated] = useState<string>("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/board")
        .then((r) => r.json())
        .then((j) => { if (live && j.rows) { setRows(j.rows); setUpdated(j.updated); setError(false); } })
        .catch(() => live && setError(true));
    load();
    const t = setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  return (
    <section className="panel board">
      <header className="panel-head">
        <div>
          <h2>Price gaps right now</h2>
          <p className="muted small">The same question on different sites. Price of YES in cents; the cheapest is highlighted.</p>
        </div>
        <span className="live-dot">{updated ? `Live · ${new Date(updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Live"}</span>
      </header>
      {error && !rows && <p className="muted small">Couldn't reach the venues just now. Try a search above.</p>}
      <div className="board-table" role="table">
        <div className="board-row head" role="row">
          <span role="columnheader">Question</span>
          {VENUE_COLS.map((v) => <span key={v.id} role="columnheader" className="tnum">{v.name}</span>)}
          <span role="columnheader" className="tnum">Cheaper by</span>
          <span role="columnheader" />
        </div>
        {!rows && Array.from({ length: 5 }, (_, i) => <div key={i} className="board-row skeleton" style={{ animationDelay: `${i * 80}ms` }} />)}
        {rows?.map((r, i) => (
          <div key={r.query} className="board-row" role="row" style={{ animationDelay: `${i * 70}ms` }}>
            <button className="q" onClick={() => onOpen(r.query, false)} title="Compare all venues">
              {r.question}
              {r.pool && <em className="pool-tag">+ NEAR pool</em>}
            </button>
            {VENUE_COLS.map((v) => {
              const cell = r.venues[v.id];
              return (
                <span key={v.id} className={`tnum cell ${r.cheapest_yes === v.id ? "best" : ""} ${v.id === "manifold" ? "play" : ""}`} data-venue={v.name}>
                  {cell ? <Flash value={cell.yes}>{cents(cell.yes)}</Flash> : <span className="dim">–</span>}
                </span>
              );
            })}
            <span className="tnum gap" title={`Price gap ${r.gap_cents}¢; after trading fees and moving money: ${r.net_gap_cents ?? "?"}¢`}>
              {r.net_gap_cents == null ? <b>{r.gap_cents}¢</b> : r.net_gap_cents > 0 ? <b>{r.net_gap_cents}¢</b> : <small className="net eaten">no real saving</small>}
            </span>
            <button className="btn small fund-btn" onClick={() => onOpen(r.query, true)}>Fund cheapest</button>
          </div>
        ))}
      </div>
      <p className="hint">
        "Cheaper by" already counts each site's fee and the cost of sending your money there. Two sites can judge the same question differently, so read the rules before you bet. Manifold is play money.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- live NEAR Intents rates

const RATE_COINS = ["NEAR on NEAR", "ETH on Ethereum", "SOL on Solana", "BTC on Bitcoin", "USDC on Base"];

export function Rates() {
  const coins = ORIGINS.filter((o) => RATE_COINS.includes(`${o.label} on ${o.chain}`));
  const [rates, setRates] = useState<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    const load = () =>
      coins.forEach((o) =>
        quote({ origin: o, chain: "Polygon", usdc: 100, dry: true })
          .then((q) => live && setRates((r) => ({ ...r, [o.assetId]: Number(q.amountInFormatted) })))
          .catch(() => {}),
      );
    load();
    const t = setInterval(load, 30_000);
    return () => { live = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>Fund any venue from</h2>
          <p className="muted small">What $100 of USDC in your Polymarket account costs right now, fees included. Quoted live by NEAR Intents.</p>
        </div>
      </header>
      <ul className="rates">
        {coins.map((o) => (
          <li key={o.assetId}>
            <span><b>{o.label}</b> <span className="muted small">on {o.chain}</span></span>
            <span className="tnum">{rates[o.assetId] != null ? <Flash value={rates[o.assetId]}>{friendlyAmount(String(rates[o.assetId]))} {o.label}</Flash> : <span className="shimmer" />}</span>
          </li>
        ))}
      </ul>
      <p className="hint">Delivered in about a minute, straight to your own venue account. Market Radar never holds it.</p>
    </section>
  );
}

// ---------------------------------------------------------------- Radar Pools (NEAR testnet)

function countdown(ms: number) {
  const s = Math.max(0, Math.round((ms - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function PoolsPanel({ onOpen }: { onOpen: (id?: string) => void }) {
  const [markets, setMarkets] = useState<PoolMarket[] | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const load = () => view<PoolMarket[]>("get_open_markets").then(setMarkets).catch(() => {});
    // Settle a finished Bitcoin round and open the next one, so the countdown is always live.
    relay({ method: "flash" }).catch(() => {}).finally(load);
    const a = setInterval(load, 15_000);
    const b = setInterval(() => tick((x) => x + 1), 1000);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);
  const open = (markets ?? []).filter((m) => m.status === "Open");
  const flash = open.filter((m) => m.category === "flash").sort((a, b) => Number(b.id) - Number(a.id))[0];
  const list = open.filter((m) => m.category !== "flash").slice(0, 4);
  return (
    <section className="panel pools-panel">
      <header className="panel-head">
        <div>
          <h2>Radar Pools <span className="net-tag">NEAR testnet</span></h2>
          <p className="muted small">Our own prediction market contract on NEAR. Test money, no wallet.</p>
        </div>
      </header>
      {flash && (
        <button className="flash-round" onClick={() => onOpen(flash.id)}>
          <span className="small muted">⚡ Bitcoin round · closes in</span>
          <b className="tnum">{Date.now() < closesMs(flash) ? countdown(closesMs(flash)) : "settling…"}</b>
          <span className="small">{flash.title.replace("Bitcoin in 2 minutes: ", "")}</span>
        </button>
      )}
      <ul className="pool-list">
        {!markets && Array.from({ length: 3 }, (_, i) => <li key={i}><span className="shimmer wide" /></li>)}
        {list.map((m) => {
          const top = m.outcomes.map((o, i) => ({ o, p: share(m, i) })).sort((a, b) => b.p - a.p)[0]!;
          return (
            <li key={m.id}>
              <button onClick={() => onOpen(m.id)}>
                <span className="pool-title">{m.title}</span>
                <span className="tnum small">{top.o} <b>{Math.round(top.p * 100)}%</b></span>
              </button>
            </li>
          );
        })}
      </ul>
      <button className="btn block" onClick={() => onOpen()}>Open Radar Pools →</button>
    </section>
  );
}
