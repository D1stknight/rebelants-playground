// components/HiveDescent/HiveDescent.tsx
// Hive Descent v2 — lobby → faction pick → turn-based 3D descent → result. Daily seed: everyone fights the same hive today.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePoints } from "../../lib/usePoints";
import { loadProfile, getEffectivePlayerId } from "../../lib/profile";
import { pointsConfig as defaultPointsConfig } from "../../lib/pointsConfig";
import { DESCENT_DEFAULT_COST, DESCENT_TOTAL_FLOORS, DESCENT_FACTIONS, DESCENT_DEATH_PENALTY, todaySeed } from "../../lib/descentConfig";
import { BIOMES } from "./biomes";
import { newRun, rarityForRun, totalPossibleRebel, type Run } from "./descentEngine";

const FactionPicker = dynamic(() => import("./FactionPicker"), { ssr: false });
const DescentBattle = dynamic(() => import("./DescentBattle"), { ssr: false });

type RunState = "lobby" | "picking" | "running" | "result";
const FONT = "'Noto Serif JP', 'Hiragino Mincho ProN', serif";
const BEST_KEY = "ra:descent:best";

type Best = { seed: string; floor: number; banked: number; faction: string; victory: boolean };
function loadBest(): Best | null { try { const v = localStorage.getItem(BEST_KEY); return v ? JSON.parse(v) : null; } catch { return null; } }

const HiveDescent: React.FC = () => {
  const [pid, setPid] = useState<string>("guest");
  useEffect(() => {
    const u = () => { try { setPid(getEffectivePlayerId(loadProfile()) || "guest"); } catch { setPid("guest"); } };
    u(); window.addEventListener("ra:identity-changed", u); return () => window.removeEventListener("ra:identity-changed", u);
  }, []);
  const { balance, spend, earn, refresh } = usePoints(pid);

  const [cfg, setCfg] = useState<any>(defaultPointsConfig);
  useEffect(() => { (async () => { try { const r = await fetch("/api/config", { cache: "no-store" }); const j = await r.json().catch(() => null); if (r.ok && j?.pointsConfig) setCfg((p: any) => ({ ...p, ...j.pointsConfig })); } catch {} })(); }, []);
  const cost = Number(cfg?.descentCost ?? DESCENT_DEFAULT_COST);

  const [runState, setRunState] = useState<RunState>("lobby");
  const [run, setRun] = useState<Run | null>(null);
  const [best, setBest] = useState<Best | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState("");
  const seed = useMemo(() => todaySeed(), []);
  useEffect(() => { setBest(loadBest()); }, []);

  const canStart = balance >= cost && !starting;

  async function handleConfirmFaction(id: string) {
    if (!canStart) return;
    setStarting(true); setErr("");
    const s = await spend(cost, "descent");
    if (!s?.ok) { setStarting(false); setErr("Couldn't charge the entry fee — check your REBEL balance."); setRunState("lobby"); return; }
    setRun(newRun(seed, id)); setRunState("running"); setStarting(false);
  }

  // ── finish (once per run)
  const finishedRef = useRef<string | null>(null);
  const finishRun = useCallback(async (r: Run) => {
    const key = `${r.seed}-${r.startedAt}`; if (finishedRef.current === key) return; finishedRef.current = key;
    const banked = Math.max(0, Math.round(r.banked));
    if (banked > 0) { try { await earn(banked); } catch {} }
    const prof = loadProfile();
    const pname = (prof?.discordName || prof?.name || "guest").trim() || "guest";
    const rarity = rarityForRun(r);
    try {
      await fetch("/api/wins/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now(), game: "descent", playerId: pid, playerName: pname, rarity, pointsAwarded: banked, survivors: r.maxFloorReached, prize: null }) });
    } catch {}
    try {
      const prev = loadBest();
      if (!prev || prev.seed !== r.seed || r.maxFloorReached > prev.floor || (r.maxFloorReached === prev.floor && banked > prev.banked)) {
        const b: Best = { seed: r.seed, floor: r.maxFloorReached, banked, faction: r.factionId, victory: r.phase === "victory" }; localStorage.setItem(BEST_KEY, JSON.stringify(b)); setBest(b);
      }
    } catch {}
    window.dispatchEvent(new Event("ra:leaderboards-refresh"));
    await refresh().catch(() => {});
  }, [earn, pid, refresh]);

  const onRun = useCallback((r: Run) => {
    setRun(r);
    if (r.phase === "dead" || r.phase === "victory" || r.phase === "cashout") { setRunState("result"); void finishRun(r); }
  }, [finishRun]);

  function handleAbandon() {
    if (run && runState === "running" && run.unbanked > 0) {
      // abandoning mid-run counts as death: keep the death share
      const r: Run = { ...run, phase: "dead", banked: Math.floor(run.unbanked * DESCENT_DEATH_PENALTY) }; setRun(r); setRunState("result"); void finishRun(r); return;
    }
    setRunState("lobby"); setRun(null);
  }

  // ===================== RUNNING =====================
  if (runState === "running" && run) return <DescentBattle run={run} onRun={onRun} onAbandon={handleAbandon} />;

  // ===================== PICKING =====================
  if (runState === "picking") return <FactionPicker onConfirm={handleConfirmFaction} onCancel={() => setRunState("lobby")} cost={cost} />;

  // ===================== RESULT =====================
  if (runState === "result" && run) {
    const victory = run.phase === "victory", cashed = run.phase === "cashout";
    const color = victory ? "#ffd700" : cashed ? "#fbbf24" : "#ff3366";
    const title = victory ? "THE QUEEN FALLS" : cashed ? "YOU ESCAPED THE HIVE" : "THE HIVE CLAIMS YOU";
    const sub = victory ? "Ten floors. No retreat. The colony is yours." : cashed ? `You left with the loot at floor ${run.floor}.` : `You fell on floor ${run.floor}. Half the unbanked loot went with you.`;
    return (
      <div style={{ minHeight: "100vh", color: "#fff", fontFamily: FONT, background: `radial-gradient(ellipse at center, ${victory ? "#4a3300" : cashed ? "#3a2a00" : "#2a0010"} 0%, #05000a 60%, #000 100%)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20, textAlign: "center" }}>
        <div style={{ fontSize: 12, color, letterSpacing: "0.5em", marginBottom: 14 }}>{victory ? "★ ★ ★ VICTORY ★ ★ ★" : cashed ? "⚑ ESCAPED ⚑" : "☠ DEFEATED ☠"}</div>
        <h1 style={{ fontSize: "clamp(34px, 8vw, 84px)", margin: 0, fontWeight: 900, letterSpacing: "0.06em", color, textShadow: `0 0 40px ${color}88` }}>{title}</h1>
        <div style={{ fontSize: 15, color: "rgba(255,255,255,0.8)", marginTop: 14, fontStyle: "italic", maxWidth: 520 }}>{sub}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10, marginTop: 28, width: "100%", maxWidth: 640 }}>
          {[
            { l: "BANKED", v: `+${run.banked}`, c: "#fbbf24" },
            { l: "DEEPEST", v: `Floor ${run.maxFloorReached}`, c: "#ff99dd" },
            { l: "TURNS", v: String(run.turns), c: "#67e8f9" },
            { l: "KILLS", v: String(run.kills), c: "#f87171" },
            { l: "CARDS", v: String(run.cardsPlayed), c: "#fde68a" },
          ].map((s) => (<div key={s.l} style={{ background: "rgba(0,0,0,0.45)", border: `1px solid ${s.c}33`, borderRadius: 12, padding: "12px 8px" }}><div style={{ fontSize: 20, fontWeight: 900, color: s.c }}>{s.v}</div><div style={{ fontSize: 9, letterSpacing: "0.25em", opacity: 0.55, marginTop: 4 }}>{s.l}</div></div>))}
        </div>
        {run.relics.length > 0 && <div style={{ marginTop: 16, fontSize: 11, opacity: 0.7 }}>Relics: {run.relics.map((r) => r.name).join(" · ")}</div>}
        <div style={{ fontSize: 10, opacity: 0.45, marginTop: 14, letterSpacing: "0.2em" }}>DAILY HIVE {run.seed} · {run.faction.name.toUpperCase()}</div>
        <div style={{ display: "flex", gap: 10, marginTop: 26, flexWrap: "wrap", justifyContent: "center" }}>
          <button type="button" onClick={() => { setRunState("lobby"); setRun(null); }} style={{ fontFamily: FONT, padding: "14px 28px", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 12, background: "rgba(255,255,255,0.06)", color: "#fff", fontWeight: 900, fontSize: 13, letterSpacing: "0.15em", cursor: "pointer" }}>↻ LOBBY</button>
          <button type="button" onClick={() => { setRun(null); setRunState("picking"); }} style={{ fontFamily: FONT, padding: "14px 28px", border: "none", borderRadius: 12, background: `linear-gradient(180deg, ${color} 0%, ${victory ? "#aa6600" : cashed ? "#9a5a00" : "#770022"} 100%)`, color: victory || cashed ? "#000" : "#fff", fontWeight: 900, fontSize: 13, letterSpacing: "0.15em", cursor: "pointer" }}>⚔ DESCEND AGAIN · {cost} REBEL</button>
        </div>
      </div>
    );
  }

  // ===================== LOBBY =====================
  const STEPS = [
    { n: "01", t: "PLAY CARDS, NOT BUTTONS", c: "#f87171", d: "Each turn you draw 5 cards and get 3 energy. The gold number on a card is its cost. Strike hits, Guard blocks, your faction card does something only you can do." },
    { n: "02", t: "READ THE INTENT", c: "#67e8f9", d: "The badge over every enemy is its next move — ⚔ Attack 6 means 6 damage is coming. Block soaks damage for one turn only, so guard the turn it matters and hit the rest of the time." },
    { n: "03", t: "ONE LIFE BAR, TEN FLOORS", c: "#4ade80", d: "Your HP does not refill between floors. Every point you lose on floor 1 is gone on floor 10 unless you Mend at a boon, heal with a card, or carry a relic that does it for you." },
    { n: "04", t: "BUILD ON THE WAY DOWN", c: "#fbbf24", d: "After each floor pick a boon: a new card for your deck, a relic that lasts all run, or +30 HP. Bosses guard floors 4, 8 and 10. On 3, 6 and 9 you may escape and bank your REBEL." },
  ];
  return (
    <div style={{ minHeight: "100vh", color: "#fff", overflowX: "hidden", fontFamily: FONT, background: "#050308", position: "relative" }}>
      {/* HERO */}
      <div style={{ position: "relative", minHeight: "min(100vh, 860px)", display: "flex", flexDirection: "column" }}>
        <div aria-hidden style={{ position: "absolute", inset: 0, backgroundImage: "url(/descent/lobby-hero.jpg)", backgroundSize: "cover", backgroundPosition: "38% 40%" }} />
        <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(5,3,8,0.15) 0%, rgba(5,3,8,0.15) 40%, rgba(5,3,8,0.82) 68%, rgba(5,3,8,0.95) 100%), linear-gradient(180deg, rgba(5,3,8,0.7) 0%, rgba(5,3,8,0) 25%, rgba(5,3,8,0) 70%, #050308 100%)" }} />

        <div style={{ position: "relative", zIndex: 2, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px" }}>
          <a href="/" style={{ color: "rgba(255,255,255,0.65)", textDecoration: "none", fontSize: 12, fontWeight: 700, letterSpacing: "0.15em" }}>← PLAYGROUND</a>
          <div style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 999, padding: "6px 14px", fontSize: 13, fontWeight: 800, color: "#fbbf24" }}>⚡ {(balance || 0).toLocaleString()} <span style={{ fontSize: 10, opacity: 0.7 }}>REBEL</span></div>
        </div>

        <div style={{ position: "relative", zIndex: 2, flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "20px 6vw 40px" }}>
          <div style={{ maxWidth: 560, width: "100%", textAlign: "left" }}>
            <div style={{ fontSize: 11, color: "#ff66cc", letterSpacing: "0.45em", fontWeight: 700 }}>◆ DAILY HIVE · {seed} ◆</div>
            <h1 style={{ fontSize: "clamp(44px, 7.5vw, 96px)", margin: "10px 0 0", fontWeight: 900, letterSpacing: "0.03em", lineHeight: 0.92, textShadow: "0 4px 40px rgba(0,0,0,0.8)" }}>THE HIVE<br /><span style={{ background: "linear-gradient(180deg, #ff99dd 0%, #ff3399 55%, #7a1a55 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>DESCENT</span></h1>
            <div style={{ fontSize: "clamp(14px, 1.6vw, 17px)", color: "rgba(255,255,255,0.82)", marginTop: 18, lineHeight: 1.55, maxWidth: 480 }}>
              Ten floors. <b>One life bar.</b> Build a deck of cards on the way down, read what the hive is about to do, and bank your REBEL before it takes it back.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
              <span style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.14)", padding: "6px 12px", borderRadius: 999, fontSize: 11, fontWeight: 800, letterSpacing: "0.1em" }}>SAME FLOORS FOR EVERYONE TODAY</span>
              <span style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.14)", padding: "6px 12px", borderRadius: 999, fontSize: 11, fontWeight: 800, letterSpacing: "0.1em" }}>{DESCENT_FACTIONS.length} CHAMPIONS</span>
              {best && best.seed === seed && <span style={{ background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24", padding: "6px 12px", borderRadius: 999, fontSize: 11, fontWeight: 800, letterSpacing: "0.1em" }}>YOUR BEST · FLOOR {best.floor}{best.victory ? " · QUEEN SLAIN" : ""} · +{best.banked}</span>}
            </div>
            <button type="button" onClick={() => canStart && setRunState("picking")} disabled={!canStart} style={{ fontFamily: FONT, marginTop: 26, padding: "20px 34px", fontSize: "clamp(15px, 2.2vw, 20px)", fontWeight: 900, letterSpacing: "0.18em", color: "#fff", border: "none", borderRadius: 14, background: canStart ? "linear-gradient(180deg, #ff3399 0%, #aa0066 55%, #5a0033 100%)" : "linear-gradient(180deg, rgba(80,30,80,0.5) 0%, rgba(40,10,40,0.7) 100%)", cursor: canStart ? "pointer" : "not-allowed", boxShadow: canStart ? "0 0 46px rgba(255,51,153,0.5), inset 0 1px 0 rgba(255,255,255,0.25)" : "none", opacity: canStart ? 1 : 0.6, transition: "all 0.2s" }}>
              ⚔ DESCEND · {cost} REBEL
            </button>
            {!canStart && !starting && <div style={{ marginTop: 10, fontSize: 12, color: "#ff99aa" }}>⚠ Need {cost} REBEL to descend. You have {balance}.</div>}
            {err && <div style={{ marginTop: 10, fontSize: 12, color: "#ff99aa" }}>{err}</div>}
            <div style={{ marginTop: 14, fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: "0.06em", lineHeight: 1.7 }}>
              Die and you keep half of what you found · escape on 3, 6 or 9 and keep it all · slay the Queen for up to {totalPossibleRebel().toLocaleString()} REBEL
            </div>
          </div>
        </div>
      </div>

      {/* HOW A RUN WORKS */}
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "10px 20px 0", position: "relative", zIndex: 2 }}>
        <div style={{ fontSize: 11, color: "#ff66cc", letterSpacing: "0.45em", textAlign: "center", marginBottom: 16 }}>◆ HOW A RUN WORKS ◆</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
          {STEPS.map((x) => (
            <div key={x.n} style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(0,0,0,0.35))", border: `1px solid ${x.c}33`, borderTop: `2px solid ${x.c}`, borderRadius: 14, padding: "16px 16px 18px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}><span style={{ fontSize: 22, fontWeight: 900, color: x.c, opacity: 0.9 }}>{x.n}</span><span style={{ fontSize: 11, letterSpacing: "0.22em", fontWeight: 800 }}>{x.t}</span></div>
              <div style={{ fontSize: 12.5, opacity: 0.82, marginTop: 8, lineHeight: 1.6 }}>{x.d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* THE DESCENT PATH */}
      <div style={{ maxWidth: 1080, margin: "38px auto 0", padding: "0 20px", position: "relative", zIndex: 2 }}>
        <div style={{ fontSize: 11, color: "#ff66cc", letterSpacing: "0.45em", textAlign: "center", marginBottom: 16 }}>◆ THE DESCENT ◆</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 6 }}>
          {BIOMES.map((b) => {
            const boss = b.kind !== "combat"; const exit = [3, 6, 9].includes(b.floor);
            return (
              <div key={b.floor} title={b.subtitle} style={{ position: "relative", background: `linear-gradient(180deg, ${b.skyTop} 0%, ${b.skyBottom} 100%)`, border: b.kind === "final_boss" ? "2px solid #ff3399" : boss ? `1.5px solid ${b.particleColor}` : "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 8px 10px", textAlign: "center", boxShadow: b.kind === "final_boss" ? "0 0 20px rgba(255,51,153,0.45)" : boss ? `0 0 14px ${b.particleColor}44` : "none", minHeight: 108 }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: boss ? b.particleColor : "rgba(255,255,255,0.85)", lineHeight: 1 }}>{b.floor}</div>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", marginTop: 6, lineHeight: 1.25, minHeight: 24 }}>{b.name.toUpperCase()}</div>
                <div style={{ fontSize: 9, color: b.particleColor, marginTop: 6, fontWeight: 700 }}>+{b.rebelReward}</div>
                {(boss || exit) && <div style={{ position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)", fontSize: 8, fontWeight: 900, letterSpacing: "0.15em", padding: "2px 7px", borderRadius: 999, background: boss ? (b.kind === "final_boss" ? "#ff3399" : b.particleColor) : "#fbbf24", color: "#000", whiteSpace: "nowrap" }}>{b.kind === "final_boss" ? "☠ QUEEN" : boss ? "☠ BOSS" : "⚑ EXIT"}</div>}
              </div>
            );
          })}
        </div>
        <div style={{ textAlign: "center", fontSize: 11, opacity: 0.5, marginTop: 12, letterSpacing: "0.08em" }}>Enemies get tougher every floor · 2 enemies early, 3 on the deep floors · the Queen fights with her Royal Guard</div>
      </div>

      <div style={{ textAlign: "center", padding: "40px 16px 30px", fontSize: 10, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", position: "relative", zIndex: 2 }}>© 2026 Rebel Ants Playground · Hive Descent</div>
    </div>
  );
};

export default HiveDescent;
