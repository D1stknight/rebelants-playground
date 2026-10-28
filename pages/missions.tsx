// Missions in the Playground: the same daily 3, weekly 3 and Season track as The Underground (one
// list across both apps). They move on their own as games report results and pay $REBEL Points
// the moment one is done. Underground missions link over to the Underground.
import Head from "next/head";
import { useEffect, useState } from "react";
import { playerId } from "../components/BadgeToast";

type Card = { id: string; app: "underground" | "playground"; game: string; name: string; need: number; have: number; reward: number; done: boolean };
type Data = {
  ok: boolean; now: number;
  daily: { ends: string; list: Card[] };
  weekly: { ends: string; list: Card[] };
  season: null | { id: string; name: string; title: string; starts: string; ends: string; started: boolean; done: number; total: number; current: Card | null };
};
const UNDERGROUND = "https://underground.rebelants.io";
const fmt = (n: number) => Number(n || 0).toLocaleString("en-US");
function left(ms: number) {
  if (ms <= 0) return "now";
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Mission({ m }: { m: Card }) {
  const pct = Math.round((100 * Math.min(m.have, m.need)) / m.need);
  const body = (
    <>
      <span className="pm-game">{m.game}{m.app === "underground" ? " · THE UNDERGROUND" : ""}</span>
      <span className="pm-name">{m.name}</span>
      <span className="pm-bar" aria-hidden="true"><i style={{ width: pct + "%" }} /></span>
      <span className="pm-foot"><span>{m.done ? "Done" : `${fmt(m.have)} of ${fmt(m.need)}`}</span><b>{m.done ? "✓ " : "+"}{fmt(m.reward)} <small>points</small></b></span>
    </>
  );
  return m.app === "underground" && !m.done
    ? <a className="pm-card" href={UNDERGROUND + "/casino"} target="_blank" rel="noopener noreferrer">{body}</a>
    : <div className={"pm-card" + (m.done ? " pm-done" : "")}>{body}</div>;
}

export default function Missions() {
  const [d, setD] = useState<Data | null>(null);
  const [state, setState] = useState<"load" | "signin" | "error" | "ok">("load");
  const [skew, setSkew] = useState(0);
  const [, tick] = useState(0);

  useEffect(() => {
    const pid = playerId();
    if (!pid || pid.startsWith("guest")) { setState("signin"); return; }
    const load = () => fetch("/api/missions?playerId=" + encodeURIComponent(pid), { cache: "no-store" }).then(async (r) => {
      if (r.status === 401) { setState("signin"); return; }
      const j = await r.json();
      if (!j.ok) { setState((s) => (s === "ok" ? s : "error")); return; }
      setD(j); setSkew(j.now - Date.now()); setState("ok");
    }).catch(() => setState((s) => (s === "ok" ? s : "error")));
    load();
    const t = setInterval(load, 30_000);
    const c = setInterval(() => tick((n) => n + 1), 30_000);
    return () => { clearInterval(t); clearInterval(c); };
  }, []);

  const now = Date.now() + skew;
  const s = d?.season;
  return (
    <main className="pm">
      <Head>
        <title>Missions — Rebel Ants Playground</title>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700;900&display=swap" rel="stylesheet" />
      </Head>
      <style>{CSS}</style>
      <header className="pm-top">
        <a href="/" className="pm-back">← Playground</a>
        <h1>MISSIONS</h1>
        <a href="/badges" className="pm-back pm-right">🏅 Badges</a>
      </header>
      <p className="pm-sub">One list for the Playground and The Underground. Finish them on any game; points land the moment you do.</p>
      {state === "load" && <p className="pm-note">Reading your orders…</p>}
      {state === "error" && <p className="pm-note">Missions could not load. Try again in a moment.</p>}
      {state === "signin" && <p className="pm-note">Sign in on the <a href="/">Playground</a> (Discord or name + PIN) to see your missions.</p>}
      {state === "ok" && d && (
        <>
          {s && (
            <section className="pm-season">
              <div className="pm-h"><span>{s.name.toUpperCase()}</span><small>{s.started ? `${left(new Date(s.ends).getTime() - now)} left` : `starts in ${left(new Date(s.starts).getTime() - now)}`}</small></div>
              <b className="pm-season-t">{s.title}</b>
              <p>Finish all {s.total} season missions, in order, for the {s.name} Medal. Each pays 100 points.</p>
              <span className="pm-bar pm-bar-big" aria-hidden="true"><i style={{ width: Math.round((100 * s.done) / s.total) + "%" }} /></span>
              <p className="pm-season-p">{s.done} of {s.total}{s.started && s.current ? <> · now: <b>{s.current.name}</b> ({fmt(s.current.have)} of {fmt(s.current.need)}{s.current.app === "underground" ? ", in The Underground" : ""})</> : s.started ? " · every mission done. Medal earned." : " · the track opens when the season starts."}</p>
            </section>
          )}
          <section className="pm-sec">
            <div className="pm-h"><span>DAILY</span><small>new set in {left(new Date(d.daily.ends).getTime() - now)} · {d.daily.list.filter((m) => m.done).length} of {d.daily.list.length} done</small></div>
            <div className="pm-grid">{d.daily.list.map((m) => <Mission key={m.id} m={m} />)}</div>
          </section>
          <section className="pm-sec">
            <div className="pm-h"><span>WEEKLY</span><small>resets Monday · {d.weekly.list.filter((m) => m.done).length} of {d.weekly.list.length} done · all 3 = Clean Sweep badge</small></div>
            <div className="pm-grid">{d.weekly.list.map((m) => <Mission key={m.id} m={m} />)}</div>
          </section>
          <a className="pm-link" href={UNDERGROUND + "/board"} target="_blank" rel="noopener noreferrer">The Underground weekly board →</a>
        </>
      )}
      <p className="pm-fine">Missions pay $REBEL Points: Rebel Ants loyalty points. Not crypto, not cash, not an investment, not transferable, not redeemable for cash.</p>
    </main>
  );
}

const CSS = `
.pm{min-height:100vh;padding:16px 16px 40px;background:radial-gradient(ellipse at top,#2a0d0a,#07080d 60%);color:#f1ece4;font-family:'Noto Serif JP',Georgia,serif;box-sizing:border-box}
.pm *{box-sizing:border-box}
.pm a{color:#fbbf24}
.pm-top{max-width:900px;margin:0 auto;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px}
.pm-top h1{margin:0;font-size:20px;font-weight:900;letter-spacing:.2em;background:linear-gradient(90deg,#ef4444,#f97316,#fbbf24);-webkit-background-clip:text;background-clip:text;color:transparent}
.pm-back{font:700 12px system-ui,sans-serif;text-decoration:none}.pm-right{justify-self:end}
.pm-sub,.pm-note{max-width:640px;margin:12px auto 0;text-align:center;font:500 13px/1.5 system-ui,sans-serif;color:#b9ae96}
.pm-season,.pm-sec{max-width:900px;margin:14px auto 0;padding:14px;border-radius:14px;background:rgba(0,0,0,.45);border:1px solid rgba(239,68,68,.28)}
.pm-season{background:linear-gradient(160deg,rgba(249,115,22,.16),rgba(0,0,0,.55));border-color:rgba(249,115,22,.55)}
.pm-h{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px}
.pm-h span{font-size:12px;font-weight:900;letter-spacing:.18em;color:#f97316}
.pm-h small{font:600 11px system-ui,sans-serif;color:#b9ae96;text-align:right}
.pm-season-t{display:block;margin:2px 0 4px;font-size:20px;font-weight:900;color:#fff}
.pm-season p{margin:0 0 10px;font:500 12px/1.45 system-ui,sans-serif;color:#e2dccc}
.pm-season .pm-season-p{margin:8px 0 0}
.pm-grid{display:grid;gap:8px}
.pm-card{display:flex;flex-direction:column;gap:4px;padding:12px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(249,115,22,.25);color:inherit!important;text-decoration:none}
a.pm-card:hover{border-color:#f97316}
.pm-done{border-color:rgba(127,224,168,.55);background:rgba(127,224,168,.07)}
.pm-game{font:800 9px ui-monospace,Menlo,monospace;letter-spacing:.16em;color:#8d8470}
.pm-name{font-size:15px;font-weight:700;color:#f1ece4}
.pm-bar{display:block;height:6px;border-radius:4px;background:rgba(255,255,255,.1);overflow:hidden;margin-top:4px}
.pm-bar i{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,#ef4444,#fbbf24)}
.pm-done .pm-bar i{background:#7fe0a8}
.pm-bar-big{height:10px}
.pm-foot{display:flex;justify-content:space-between;align-items:baseline;font:600 12px system-ui,sans-serif;color:#b9ae96}
.pm-foot b{font:900 14px system-ui,sans-serif;color:#fbbf24}.pm-foot b small{font-size:10px;color:#b9ae96}
.pm-done .pm-foot b{color:#7fe0a8}
.pm-link{display:block;max-width:900px;margin:16px auto 0;text-align:center;font:800 14px system-ui,sans-serif;text-decoration:none}
.pm-fine{max-width:640px;margin:22px auto 0;text-align:center;font:500 11px/1.5 system-ui,sans-serif;color:#8d8470}
@media (min-width:760px){.pm-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
`;
