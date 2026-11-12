import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Pools } from "./Pools";
import { Board, PoolsPanel, Radar, Rates } from "./Overview";
import {
  DESTINATIONS, ORIGINS, USDC_CONTRACT, friendlyAmount, looksLikeAddress, quote, swapStatus,
  type Chain, type Destination, type Origin, type Quote, type SwapStatus,
} from "./lib/intents";

// ---------------------------------------------------------------- types

interface Market {
  venue: "polymarket" | "kalshi" | "limitless" | "manifold";
  venue_name: string;
  trust: "regulated" | "high" | "medium" | "play_money";
  market_ref: string;
  title: string;
  event_title: string | null;
  yes_price: number | null;
  no_price: number | null;
  volume: number | null;
  volume_unit: string;
  closes_at: string | null;
  url: string;
}
interface SearchResult {
  topic: string;
  markets: Market[];
  /** The best match plus the same question on other venues, with the cheapest prices marked. */
  compare: { question: string; refs: string[]; cheapest_yes: string | null; cheapest_no: string | null; spread_cents: number } | null;
  venues: { venue: string; ok: boolean; found: number }[];
  /** Radar Pools (our NEAR testnet market) asking the same question. */
  pools: { id: string; title: string; outcomes: string[]; pools: string[]; closes_at: string }[];
}
type Net = "mainnet" | "testnet";
type Side = "YES" | "NO";

const EXAMPLES = ["Bitcoin above 150k", "Fed rate cut", "PSG vs Barcelona", "Nigeria election 2027", "Taylor Swift"];
const TRUST: Record<Market["trust"], string> = { regulated: "Regulated", high: "High trust", medium: "Smaller venue", play_money: "Play money" };
const cents = (p: number | null) => (p == null ? "–" : `${Math.round(p * 100)}¢`);
const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const shortVol = (v: number | null, unit: string) =>
  v == null ? null : `${v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : v.toFixed(0)} ${unit === "MANA" ? "mana" : unit === "contracts" ? "contracts" : "$"} volume`;

// ---------------------------------------------------------------- app

export function App() {
  const params = new URLSearchParams(location.search);
  const [net, setNetState] = useState<Net>(params.get("net") === "testnet" ? "testnet" : "mainnet");
  const [focus, setFocus] = useState<string | undefined>(params.get("pool") ?? undefined);
  const setNet = (n: Net, pool?: string) => {
    const u = new URLSearchParams(location.search);
    if (n === "testnet") u.set("net", "testnet"); else u.delete("net");
    if (pool) u.set("pool", pool); else u.delete("pool");
    history.replaceState(null, "", `?${u}`);
    setFocus(pool);
    setNetState(n);
    window.scrollTo(0, 0);
  };
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<{ market: Market; side: Side } | null>(null);

  const run = async (text: string, fundCheapest = false) => {
    const query = text.trim();
    if (query.length < 2) return;
    setQ(query);
    setBusy(true);
    setError("");
    setPicked(null);
    history.replaceState(null, "", `?q=${encodeURIComponent(query)}`);
    setNetState("mainnet");
    try {
      const res = await fetch(`/api/scout?q=${encodeURIComponent(query)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Search failed (${res.status})`);
      setResult(json);
      if (fundCheapest && json.compare?.cheapest_yes) {
        const m = (json.markets as Market[]).find((x) => x.market_ref === json.compare.cheapest_yes);
        if (m) setPicked({ market: m, side: "YES" });
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (q && net === "mainnet") run(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Header net={net} setNet={setNet} />
      <main className="wrap">
        {net === "testnet" ? <Pools focus={focus} /> : <>
        <section className={`top ${result || busy ? "compact" : ""}`}>
          <div className="top-text">
            <span className="eyebrow">Prediction market aggregator · powered by NEAR Intents</span>
            {!result && !busy && (
              <>
                <h1>Every prediction market.<br /><span className="accent">One radar.</span></h1>
                <p className="lead">Compare the same question on Polymarket, Kalshi, Limitless and Manifold, then fund the cheapest from any coin you hold.</p>
              </>
            )}
            <form className="search" onSubmit={(e) => { e.preventDefault(); run(q); }}>
              <span className="search-icon" aria-hidden="true">⌕</span>
              <input aria-label="What do you want to bet on?" placeholder="Search any question: bitcoin 100k, Arsenal, election 2027…" value={q} onChange={(e) => setQ(e.target.value)} />
              <button className="btn" disabled={busy || q.trim().length < 2}>{busy ? <span className="spinner" /> : "Scan"}</button>
            </form>
            <div className="chips">
              {result && <button className="chip back" onClick={() => { setResult(null); setPicked(null); setQ(""); history.replaceState(null, "", "/"); }}>← Overview</button>}
              {EXAMPLES.map((x) => <button key={x} className="chip" onClick={() => run(x)}>{x}</button>)}
            </div>
          </div>
          {!result && !busy && <Radar />}
        </section>

        {error && <div className="card bad">{error}</div>}
        {busy && <div className="card center muted scanning"><span className="spinner dark" /> Scanning Polymarket, Kalshi, Limitless and Manifold…</div>}
        {!busy && result && <Results result={result} picked={picked} onPick={setPicked} onPool={(id) => setNet("testnet", id)} />}
        {!result && !busy && (
          <div className="overview">
            <Board onOpen={(query, fund) => run(query, fund)} />
            <aside className="side">
              <Rates />
              <PoolsPanel onOpen={(id) => setNet("testnet", id)} />
            </aside>
          </div>
        )}
        </>}
      </main>
      <footer className="site-footer">
        <div className="foot-brand"><img src="/radar.svg" alt="" /> <b>Market Radar</b> <span className="muted">· built on NEAR</span></div>
        <nav>
          <a href="https://github.com/Bellickkruz/market-radar" target="_blank" rel="noreferrer">GitHub</a>
          <a href="https://testnet.nearblocks.io/address/pools.mradar-mwcw3x85.testnet" target="_blank" rel="noreferrer">Radar Pools contract</a>
          <a href="https://docs.near-intents.org" target="_blank" rel="noreferrer">NEAR Intents</a>
        </nav>
        <p className="muted">Market Radar never holds your money: NEAR Intents sends it from your wallet straight to your own venue account. Prices are live quotes, not advice. Check that prediction markets are legal where you live.</p>
      </footer>
    </>
  );
}

function Header({ net, setNet }: { net: Net; setNet: (n: Net) => void }) {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("mr:theme", next); } catch { /* not remembered */ }
    setDark(!dark);
  };
  return (
    <header className="header">
      <a className="logo" href="/"><img src="/radar.svg" alt="" /> <b>Market<span>Radar</span></b></a>
      <span className="row" style={{ gap: 8 }}>
        <span className="netswitch" role="group" aria-label="Network">
          <button className={net === "mainnet" ? "on" : ""} onClick={() => setNet("mainnet")}>Mainnet</button>
          <button className={net === "testnet" ? "on" : ""} onClick={() => setNet("testnet")}>Testnet</button>
        </span>
        <button className="icon-btn" onClick={flip} aria-label={dark ? "Light mode" : "Dark mode"}>{dark ? "☀️" : "🌙"}</button>
      </span>
    </header>
  );
}

// ---------------------------------------------------------------- results

type Pick = { market: Market; side: Side } | null;

function Results({ result, picked, onPick, onPool }: { result: SearchResult; picked: Pick; onPick: (p: Pick) => void; onPool: (id: string) => void }) {
  if (!result.markets.length) {
    return (
      <div className="card center">
        <h3>No live market for "{result.topic}" yet</h3>
        <p className="muted">Try fewer words, or a team or person's name. You can also create this market on <a href="https://manifold.markets/create" target="_blank" rel="noreferrer">Manifold</a>.</p>
      </div>
    );
  }
  const down = result.venues.filter((v) => !v.ok).map((v) => v.venue);
  const c = result.compare;
  const byRef = new Map(result.markets.map((m) => [m.market_ref, m]));
  const group = c ? c.refs.map((r) => byRef.get(r)!).filter(Boolean) : [];
  const rest = result.markets.filter((m) => !c?.refs.includes(m.market_ref));
  const pickedInGroup = picked && group.includes(picked.market);
  return (
    <section>
      <p className="muted small">
        {result.markets.length} markets for <b>"{result.topic}"</b> · checked {result.venues.map((v) => `${v.venue} (${v.ok ? v.found : "offline"})`).join(", ")}
        {down.length ? `. ${down.join(", ")} didn't answer, try again in a moment.` : ""}
      </p>

      {c && (
        <article className="card compare">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>📡 Same question on {group.length} venues</b>
            {c.spread_cents > 0 && <span className="pill">{c.spread_cents}¢ price gap</span>}
          </div>
          <h3 className="mtitle">{c.question}</h3>
          <div className="cmp-rows">
            {group.map((m) => (
              <div key={m.market_ref} className="cmp-row">
                <div className="cmp-venue">
                  <span className={`venue v-${m.venue}`}>{m.venue_name}</span>
                  <a className="small" href={m.url} target="_blank" rel="noreferrer">open ↗</a>
                </div>
                <Prices m={m} cheapYes={c.cheapest_yes === m.market_ref} cheapNo={c.cheapest_no === m.market_ref} picked={picked} onPick={onPick} />
              </div>
            ))}
          </div>
          <p className="hint">Each venue words it a little differently; open them to check the exact rules before betting. Manifold is play money.</p>
          {pickedInGroup && <Fund key={picked!.market.market_ref + picked!.side} market={picked!.market} side={picked!.side} dest={DESTINATIONS[picked!.market.venue as Destination["venue"]]} />}
        </article>
      )}

      {result.pools?.map((p) => {
        const sum = p.pools.reduce((s, x) => s + Number(x), 0);
        return (
          <article key={p.id} className="card pool-hint">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="venue v-radar">Radar Pools · NEAR</span>
              <span className="pill">🧪 testnet only</span>
            </div>
            <h3 className="mtitle">{p.title}</h3>
            <div className="row" style={{ gap: 6 }}>
              {p.outcomes.map((o, i) => <span key={o} className="chip static">{o} {sum ? Math.round((Number(p.pools[i]) / sum) * 100) : 0}%</span>)}
            </div>
            <p className="hint">The same question on our own prediction market contract on NEAR. Test money only; real-money betting needs licences.</p>
            <button className="btn small" style={{ marginTop: 8 }} onClick={() => onPool(p.id)}>Try it on testnet →</button>
          </article>
        );
      })}

      {rest.length > 0 && c && <h3 style={{ margin: "18px 0 10px" }}>More markets</h3>}
      <div className="results">
        {rest.map((m) => (
          <article key={m.venue + m.market_ref} className={`card market ${picked?.market === m ? "open" : ""}`}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className={`venue v-${m.venue}`}>{m.venue_name}</span>
              <span className="muted small">{TRUST[m.trust]}</span>
            </div>
            {m.event_title && m.event_title !== m.title && <p className="muted small" style={{ margin: "8px 0 0" }}>{m.event_title}</p>}
            <h3 className="mtitle">{m.title}</h3>
            <Prices m={m} cheapYes={false} cheapNo={false} picked={picked} onPick={onPick} />
            <p className="muted small" style={{ margin: "8px 0 0" }}>
              {[shortVol(m.volume, m.volume_unit), m.closes_at && `closes ${new Date(m.closes_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`].filter(Boolean).join(" · ")}
              {" · "}<a href={m.url} target="_blank" rel="noreferrer">Open on {m.venue_name} ↗</a>
            </p>
            {m.trust === "play_money" && <p className="hint">Play money: shown as a crowd signal only, nothing to fund.</p>}
            {picked?.market === m && m.venue !== "manifold" && (
              <Fund key={m.market_ref + picked.side} market={m} side={picked.side} dest={DESTINATIONS[m.venue as Destination["venue"]]} />
            )}
          </article>
        ))}
      </div>
      <p className="hint center">Tap a YES or NO price to fund that bet.</p>
    </section>
  );
}

function Prices({ m, cheapYes, cheapNo, picked, onPick }: { m: Market; cheapYes: boolean; cheapNo: boolean; picked: Pick; onPick: (p: Pick) => void }) {
  return (
    <div className="prices">
      {(["YES", "NO"] as Side[]).map((side) => {
        const p = side === "YES" ? m.yes_price : m.no_price;
        const on = picked?.market === m && picked.side === side;
        return (
          <button key={side} className={`price ${side === "YES" ? "yes" : "no"} ${on ? "on" : ""}`}
            disabled={m.trust === "play_money" || p == null}
            onClick={() => onPick(on ? null : { market: m, side })}>
            <span>{side}</span><b>{cents(p)}</b>
            {(side === "YES" ? cheapYes : cheapNo) && <em>cheapest</em>}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- funding

function Fund({ market, side, dest }: { market: Market; side: Side; dest: Destination }) {
  const [usd, setUsd] = useState("50");
  const [chain, setChain] = useState<Chain>(dest.chains[0]);
  const [venueAddr, setVenueAddr] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [origin, setOrigin] = useState<Origin>(ORIGINS[0]);
  const [refundTo, setRefundTo] = useState("");
  const [preview, setPreview] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deal, setDeal] = useState<Quote | null>(null);

  const amount = Number(usd);
  const amountOk = isFinite(amount) && amount >= 1 && amount <= 100_000;
  const price = side === "YES" ? market.yes_price : market.no_price;
  const shares = price ? amount / price : 0;
  const addrOk = looksLikeAddress(chain, venueAddr);
  const refundOk = looksLikeAddress(origin.chain, refundTo);

  // Live prices for every coin (price-only quotes: no address is created, nothing can be sent).
  useEffect(() => {
    if (!amountOk) return;
    let live = true;
    setPreview({});
    const t = setTimeout(() => {
      ORIGINS.forEach((o) =>
        quote({ origin: o, chain, usdc: amount, dry: true })
          .then((qt) => live && setPreview((p) => ({ ...p, [o.assetId]: `${friendlyAmount(qt.amountInFormatted)} ${o.label}` })))
          .catch((e) => live && setPreview((p) => ({ ...p, [o.assetId]: /least \$(\d+)/.exec(String(e.message))?.[0] ? `min $${/least \$(\d+)/.exec(String(e.message))![1]}` : "–" }))),
      );
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [amount, amountOk, chain]);

  const getDetails = async () => {
    setBusy(true);
    setError("");
    try {
      setDeal(await quote({ origin, chain, usdc: amount, recipient: venueAddr, refundTo, dry: false }));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  if (deal) return <Deposit deal={deal} origin={origin} dest={dest} chain={chain} usd={amount} onBack={() => setDeal(null)} />;

  return (
    <div className="fund stack">
      <div className="step">
        <span className="num">1</span>
        <div className="grow">
          <label htmlFor="usd">How much for <b>{side}</b> on {dest.name}?</label>
          <div className="row">
            <input id="usd" className="amt" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value.replace(/[^\d.]/g, ""))} />
            {[25, 50, 100, 250].map((n) => <button key={n} className={`chip ${amount === n ? "on" : ""}`} onClick={() => setUsd(String(n))}>${n}</button>)}
          </div>
          {amountOk && price ? (
            <p className="hint">At {cents(price)} that's about <b>{Math.floor(shares).toLocaleString("en-US")} {side} shares</b>, paying <b>{money(Math.floor(shares))}</b> if {side} wins (before {dest.name}'s fees).</p>
          ) : null}
        </div>
      </div>

      <div className="step">
        <span className="num">2</span>
        <div className="grow">
          <label>Your {dest.name} deposit address</label>
          <p className="hint" style={{ marginTop: 0 }}>{dest.howTo}</p>
          <p className="signup">
            New to {dest.name}? <a href={dest.signup.url} target="_blank" rel="noreferrer">Create an account on {dest.name} ↗</a>, then come back and paste your deposit address here.
            <span className="muted"> {dest.signup.note}</span>
          </p>
          {dest.chains.length > 1 && (
            <div className="chips" style={{ marginBottom: 8 }}>
              {dest.chains.map((c) => <button key={c} className={`chip ${chain === c ? "on" : ""}`} onClick={() => { setChain(c); setConfirmed(false); }}>USDC on {c}</button>)}
            </div>
          )}
          <input aria-label={`${dest.name} deposit address`} placeholder={chain === "Solana" ? "Solana address" : "0x…"} value={venueAddr}
            onChange={(e) => { setVenueAddr(e.target.value.trim()); setConfirmed(false); }} />
          {venueAddr && !addrOk && <p className="err small">That isn't a {chain} address. Copy it again from {dest.name}.</p>}
          <label className="check">
            <input type="checkbox" checked={confirmed} disabled={!addrOk} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>My {dest.name} deposit screen says <b>USDC on {chain}</b>{USDC_CONTRACT[chain] ? <> (token <code>{USDC_CONTRACT[chain]!.slice(0, 6)}…{USDC_CONTRACT[chain]!.slice(-4)}</code>)</> : null} for this address.</span>
          </label>
        </div>
      </div>

      <div className={`step ${confirmed && amountOk ? "" : "dim"}`}>
        <span className="num">3</span>
        <div className="grow">
          <label>Pay with what you already have</label>
          <div className="coins">
            {ORIGINS.map((o) => (
              <button key={o.assetId} className={`coin ${origin === o ? "on" : ""}`} onClick={() => setOrigin(o)}>
                <span className="small muted">{o.label} on {o.chain}</span>
                <b>{amountOk ? preview[o.assetId] ?? <span className="spinner dark" /> : "–"}</b>
              </button>
            ))}
          </div>
          <p className="hint">Live NEAR Intents prices for delivering exactly {amountOk ? money(amount) : "your amount"} USDC on {chain}, all fees included.</p>
        </div>
      </div>

      <div className={`step ${confirmed && amountOk ? "" : "dim"}`}>
        <span className="num">4</span>
        <div className="grow">
          <label htmlFor="refund">Your {origin.label} address on {origin.chain}</label>
          <input id="refund" placeholder={origin.addressHint} value={refundTo} onChange={(e) => setRefundTo(e.target.value.trim())} />
          <p className="hint">Only used to send your coins back automatically if the swap can't complete.</p>
          {error && <p className="err">{error}</p>}
          <button className="btn big block" disabled={busy || !amountOk || !confirmed || !refundOk} onClick={getDetails}>
            {busy ? <span className="spinner" /> : `Get payment details`}
          </button>
          <p className="hint center">Nothing is sent yet. You'll see the exact amount and address first.</p>
        </div>
      </div>
    </div>
  );
}

function Qr({ text }: { text: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { QRCode.toDataURL(text, { margin: 1, width: 300 }).then(setSrc); }, [text]);
  return src ? <img className="qr" src={src} alt="Deposit address QR code" width={180} height={180} /> : null;
}

const EXPLORER: Partial<Record<Chain, string>> = {
  Polygon: "https://polygonscan.com/tx/", Base: "https://basescan.org/tx/", Solana: "https://solscan.io/tx/",
  Ethereum: "https://etherscan.io/tx/", Arbitrum: "https://arbiscan.io/tx/",
};

function Deposit({ deal, origin, dest, chain, usd, onBack }: { deal: Quote; origin: Origin; dest: Destination; chain: Chain; usd: number; onBack: () => void }) {
  const [status, setStatus] = useState<SwapStatus>("PENDING_DEPOSIT");
  const [hashes, setHashes] = useState<string[]>([]);
  useEffect(() => {
    if (!deal.depositAddress) return;
    const tick = () => swapStatus(deal.depositAddress!, deal.depositMemo).then((s) => { setStatus(s.status); setHashes(s.hashes); }).catch(() => {});
    tick();
    const t = setInterval(tick, 6000);
    return () => clearInterval(t);
  }, [deal]);
  const label = useMemo(() => ({
    PENDING_DEPOSIT: "Waiting for your payment…",
    KNOWN_DEPOSIT_TX: "⏳ Payment seen, converting…",
    PROCESSING: "⏳ Converting to USDC…",
    SUCCESS: `✅ ${money(usd)} USDC delivered to your ${dest.name} account`,
    INCOMPLETE_DEPOSIT: "⚠️ The amount sent was too small; it will be refunded to you.",
    REFUNDED: "↩️ Refunded to your address.",
    FAILED: "↩️ Something went wrong; your payment is being refunded.",
  })[status], [status, usd, dest.name]);
  return (
    <div className="fund stack">
      <div className="deal">
        <p style={{ margin: 0 }}>Send exactly</p>
        <div className="big-amt">{deal.amountInFormatted} {origin.label}</div>
        <p className="small muted" style={{ margin: 0 }}>on <b>{origin.chain}</b> to the address below. About {deal.timeEstimate ?? 60} seconds later, <b>{money(usd)} USDC</b> arrives in your {dest.name} account on {chain}.</p>
      </div>
      <div className="center"><Qr text={deal.depositAddress!} /></div>
      <Copy label={`${origin.label} deposit address (${origin.chain})`} value={deal.depositAddress!} />
      {deal.depositMemo && <Copy label="Memo (required)" value={deal.depositMemo} />}
      <p className="center"><b>{label}</b></p>
      {status === "SUCCESS" && (
        <div className="row" style={{ justifyContent: "center" }}>
          <a className="btn" href={dest.url} target="_blank" rel="noreferrer">Place your bet on {dest.name} ↗</a>
          {hashes[0] && EXPLORER[chain] && <a className="btn ghost" href={`${EXPLORER[chain]}${hashes[0]}`} target="_blank" rel="noreferrer">See the transfer ↗</a>}
        </div>
      )}
      <p className="hint center">This address is valid for 30 minutes and only for {origin.label} on {origin.chain}. This page updates by itself.</p>
      <button className="btn ghost small" onClick={onBack}>Change coin or amount</button>
    </div>
  );
}

function Copy({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      <label>{label}</label>
      <div className="copy">
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <button className="btn small ghost" onClick={() => navigator.clipboard.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
          {done ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
