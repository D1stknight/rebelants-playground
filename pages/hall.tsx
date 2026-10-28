// Hall of Badges: missions and badges in one place (finishing missions earns badges). The weekly
// board lives in The Underground's Hall. Old links (/missions, /badges) land here on the right tab.
import Head from "next/head";
import { useEffect, useState } from "react";
import { MissionsPanel } from "../components/hall/missions";
import { BadgesPanel } from "../components/hall/badges";

type Tab = "missions" | "badges";
const TABS: [Tab, string][] = [["missions", "🎯 MISSIONS"], ["badges", "🏅 BADGES"]];

export default function HallOfBadges() {
  const [tab, setTab] = useState<Tab>("missions");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("tab");
    if (q === "missions" || q === "badges") setTab(q);
    try { localStorage.setItem("hall-seen", String(Date.now())); } catch { /* ok */ }
  }, []);
  const pick = (t: Tab) => {
    setTab(t);
    try { window.history.replaceState(null, "", "/hall?tab=" + t); } catch { /* ok */ }
  };
  return (
    <main className="ph">
      <Head>
        <title>Hall of Badges — Rebel Ants Playground</title>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700;900&display=swap" rel="stylesheet" />
      </Head>
      <style>{CSS}</style>
      <nav className="ph-nav"><a href="/">← Playground</a></nav>
      <header className="ph-head">
        <h1>HALL OF BADGES</h1>
        <p>Every badge, every app. Earn your place.</p>
      </header>
      <div className="ph-tabs" role="tablist" aria-label="Hall of Badges">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={"ph-tab" + (tab === k ? " ph-on" : "")} onClick={() => pick(k)}>{l}</button>
        ))}
        <a className="ph-tab" href="https://underground.rebelants.io/hall?tab=board" target="_blank" rel="noopener noreferrer">🏆 BOARD ↗</a>
      </div>
      <div role="tabpanel">
        {tab === "missions" ? <MissionsPanel /> : <BadgesPanel />}
      </div>
      <p className="ph-foot">Badges are collectibles: not points, not crypto, no cash value. $REBEL Points are Rebel Ants loyalty points: not crypto, not cash, not an investment, not transferable, not redeemable for cash.</p>
    </main>
  );
}

const CSS = `
.ph{min-height:100vh;padding:16px 16px 40px;background:radial-gradient(ellipse at top,#2a0d0a,#07080d 60%);color:#f1ece4;font-family:'Noto Serif JP',Georgia,serif;box-sizing:border-box}
.ph *{box-sizing:border-box}
.ph a{color:#fbbf24}
.ph-nav{max-width:900px;margin:0 auto}.ph-nav a{font:700 12px system-ui,sans-serif;text-decoration:none}
.ph-head{max-width:900px;margin:10px auto 0;text-align:center}
.ph-head h1{margin:0;font-size:clamp(26px,6.5vw,40px);font-weight:900;letter-spacing:.14em;background:linear-gradient(90deg,#ef4444,#f97316,#fbbf24);-webkit-background-clip:text;background-clip:text;color:transparent;text-wrap:balance}
.ph-head p{margin:8px 0 0;font:600 13px system-ui,sans-serif;letter-spacing:.04em;color:#e2d6c3}
.ph-tabs{position:sticky;top:0;z-index:5;max-width:900px;margin:14px auto 0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:6px;border-radius:999px;background:rgba(10,6,6,.9);border:1.5px solid rgba(249,115,22,.4);backdrop-filter:blur(6px)}
.ph-tab{display:flex;align-items:center;justify-content:center;height:42px;border-radius:999px;cursor:pointer;background:transparent;border:1.5px solid transparent;color:#e7d9c4!important;font:800 11px ui-monospace,Menlo,monospace;letter-spacing:.12em;text-decoration:none}
.ph-on{border-color:#fbbf24;color:#fbbf24!important;background:linear-gradient(135deg,rgba(239,68,68,.25),rgba(249,115,22,.18));box-shadow:0 0 14px rgba(249,115,22,.35)}
.ph-foot{max-width:640px;margin:22px auto 0;text-align:center;font:500 11px/1.5 system-ui,sans-serif;color:#8d8470}
`;
