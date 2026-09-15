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
  if (runState === "picking") return <FactionPicker onConfirm={handleConfirmFaction} onCancel={() => setRunState("lobby")} />;

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
            { l: "CRITS", v: String(run.crits), c: "#fde68a" },
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
  return (
    <div style={{ minHeight: "100vh", color: "#fff", overflowX: "hidden", fontFamily: FONT, background: "radial-gradient(ellipse at 50% 0%, #2a0830 0%, #0a0210 50%, #000 100%)", position: "relative" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.6, backgroundImage: "radial-gradient(2px 2px at 20% 30%, #ff66cc, transparent 50%), radial-gradient(1px 1px at 80% 20%, #aa66ff, transparent 50%), radial-gradient(1.5px 1.5px at 60% 70%, #ff88dd, transparent 50%), radial-gradient(1px 1px at 10% 80%, #cc55ee, transparent 50%), radial-gradient(2px 2px at 90% 60%, #ff99dd, transparent 50%)" }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", position: "relative", zIndex: 2 }}>
        <a href="/" style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none", fontSize: 12, fontWeight: 700, letterSpacing: "0.15em" }}>← PLAYGROUND</a>
        <div style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 999, padding: "6px 14px", fontSize: 13, fontWeight: 800, color: "#fbbf24" }}>⚡ {(balance || 0).toLocaleString()} <span style={{ fontSize: 10, opacity: 0.7 }}>REBEL</span></div>
      </div>

      <div style={{ textAlign: "center", padding: "26px 16px 12px", position: "relative", zIndex: 2 }}>
        <div style={{ fontSize: 11, color: "#ff66cc", letterSpacing: "0.5em", textTransform: "uppercase", marginBottom: 10, fontWeight: 700 }}>◆ Rebel Ants Playground ◆</div>
        <h1 style={{ fontSize: "clamp(38px, 9vw, 88px)", margin: 0, fontWeight: 900, letterSpacing: "0.04em", lineHeight: 0.95, background: "linear-gradient(180deg, #fff 0%, #ff99dd 60%, #aa3388 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>THE HIVE</h1>
        <h1 style={{ fontSize: "clamp(38px, 9vw, 88px)", margin: 0, fontWeight: 900, letterSpacing: "0.04em", lineHeight: 0.95, background: "linear-gradient(180deg, #ff99dd 0%, #aa3388 50%, #4a0a30 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>DESCENT</h1>
        <div style={{ fontSize: "clamp(13px, 2vw, 16px)", color: "rgba(255,255,255,0.7)", marginTop: 18, maxWidth: 580, marginLeft: "auto", marginRight: "auto", fontStyle: "italic", lineHeight: 1.5 }}>
          "The Queen has been corrupted. Ten floors stand between you and her throne. Read the enemy. Pick your moment. Bank your loot — or lose half of it in the dark."
        </div>
      </div>

      {/* Daily hive strip */}
      <div style={{ maxWidth: 760, margin: "18px auto 0", padding: "0 16px", position: "relative", zIndex: 2 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          <span style={{ background: "rgba(255,102,204,0.15)", color: "#ff99dd", padding: "6px 12px", borderRadius: 999, fontSize: 11, fontWeight: 800, letterSpacing: "0.1em" }}>TODAY'S HIVE · {seed}</span>
          <span style={{ background: "rgba(255,255,255,0.08)", color: "#fff", padding: "6px 12px", borderRadius: 999, fontSize: 11, fontWeight: 800, letterSpacing: "0.1em" }}>SAME FLOORS FOR EVERY COMMANDER</span>
          {best && best.seed === seed && <span style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24", padding: "6px 12px", borderRadius: 999, fontSize: 11, fontWeight: 800, letterSpacing: "0.1em" }}>YOUR BEST TODAY · FLOOR {best.floor}{best.victory ? " · QUEEN SLAIN" : ""} · +{best.banked}</span>}
        </div>
      </div>

      {/* How it plays */}
      <div style={{ maxWidth: 980, margin: "26px auto 0", padding: "0 16px", position: "relative", zIndex: 2, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
        {[
          { t: "READ THE ENEMY", d: "Every foe shows its next move. Heavy strike coming? Defend. Guarding? Hit it with Magic.", c: "#67e8f9" },
          { t: "FOUR MOVES", d: "Attack · Defend · your faction's Special · Magic. Cooldowns make every turn a decision.", c: "#f87171" },
          { t: "BOONS BETWEEN FLOORS", d: "Mend, sharpen, or take a relic. 22 relics, three rarities, real build paths.", c: "#c084fc" },
          { t: "BANK OR PUSH", d: "Escape with your loot on floors 3, 6 and 9. Die and you keep half. Slay the Queen and keep it all.", c: "#fbbf24" },
        ].map((x) => (<div key={x.t} style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${x.c}33`, borderRadius: 12, padding: "12px 14px" }}><div style={{ fontSize: 10, letterSpacing: "0.25em", color: x.c, fontWeight: 700 }}>{x.t}</div><div style={{ fontSize: 12, opacity: 0.8, marginTop: 6, lineHeight: 1.5 }}>{x.d}</div></div>))}
      </div>

      {/* The 10 floors */}
      <div style={{ maxWidth: 980, margin: "28px auto 0", padding: "0 16px", position: "relative", zIndex: 2 }}>
        <div style={{ fontSize: 11, color: "#ff66cc", letterSpacing: "0.4em", textTransform: "uppercase", textAlign: "center", marginBottom: 12 }}>⛓ Ten Floors of Hell ⛓</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
          {BIOMES.map((b) => (
            <div key={b.floor} style={{ background: `linear-gradient(180deg, ${b.skyTop} 0%, ${b.skyBottom} 100%)`, border: b.kind === "final_boss" ? "2px solid #ff3399" : b.kind === "mini_boss" ? `1.5px solid ${b.particleColor}` : "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "10px 12px", boxShadow: b.kind === "final_boss" ? "0 0 16px rgba(255,51,153,0.4)" : "none" }}>
              <div style={{ fontSize: 9, letterSpacing: "0.2em", fontWeight: 700, color: b.kind === "combat" ? "rgba(255,255,255,0.45)" : b.particleColor }}>FLOOR {b.floor}{b.kind === "mini_boss" ? " · BOSS" : b.kind === "final_boss" ? " · FINAL" : ""}{[3, 6, 9].includes(b.floor) ? " · ⚑ EXIT" : ""}</div>
              <div style={{ fontSize: 14, fontWeight: 800, marginTop: 2 }}>{b.name}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", fontStyle: "italic", marginTop: 2 }}>{b.subtitle}</div>
              <div style={{ fontSize: 10, color: b.particleColor, marginTop: 4, fontWeight: 700 }}>+{b.rebelReward} REBEL</div>
            </div>
          ))}
        </div>
      </div>

      {/* START */}
      <div style={{ maxWidth: 720, margin: "34px auto 24px", padding: "0 16px", textAlign: "center", position: "relative", zIndex: 2 }}>
        <button type="button" onClick={() => canStart && setRunState("picking")} disabled={!canStart} style={{ fontFamily: FONT, width: "100%", padding: "22px 24px", fontSize: "clamp(16px, 4vw, 22px)", fontWeight: 900, letterSpacing: "0.15em", color: "#fff", border: "none", borderRadius: 14, background: canStart ? "linear-gradient(180deg, #ff3399 0%, #aa0066 50%, #5a0033 100%)" : "linear-gradient(180deg, rgba(80,30,80,0.5) 0%, rgba(40,10,40,0.7) 100%)", cursor: canStart ? "pointer" : "not-allowed", boxShadow: canStart ? "0 0 40px rgba(255,51,153,0.5), inset 0 1px 0 rgba(255,255,255,0.2)" : "none", opacity: canStart ? 1 : 0.6, transition: "all 0.2s" }}>
          ⚔ DESCEND · {cost} REBEL ⚔
        </button>
        {!canStart && !starting && <div style={{ marginTop: 10, fontSize: 12, color: "#ff99aa" }}>⚠ Need {cost} REBEL to descend. You have {balance}.</div>}
        {err && <div style={{ marginTop: 10, fontSize: 12, color: "#ff99aa" }}>{err}</div>}
        <div style={{ marginTop: 14, fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: "0.05em", lineHeight: 1.7 }}>
          🐜 {DESCENT_FACTIONS.length} factions, each with its own Special · ❤️ 100 HP · 🎲 Turn-based — no twitch, all nerve<br />
          💎 Up to {totalPossibleRebel().toLocaleString()} REBEL on a perfect {DESCENT_TOTAL_FLOORS}-floor run
        </div>
      </div>

      <div style={{ textAlign: "center", padding: "20px 16px 30px", fontSize: 10, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", position: "relative", zIndex: 2 }}>© 2026 Rebel Ants Playground · Hive Descent</div>
    </div>
  );
};

export default HiveDescent;
