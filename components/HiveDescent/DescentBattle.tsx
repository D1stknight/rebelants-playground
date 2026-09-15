// components/HiveDescent/DescentBattle.tsx
// Turn-based duel UI on top of the DescentArena. Drives the pure engine, animates its events, offers rewards.
import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ArenaActor } from "./DescentArena";
import type { DescentAnim } from "./DescentCharacter";
import { biomeOf, currentEnemy, takeTurn, beginBattle, chooseReward, specialCooldownTurns, type Run, type Action, type Ev, type RewardOffer } from "./descentEngine";
import { getRarityColor } from "./relics";
import { DESCENT_TOTAL_FLOORS, MAGIC_COOLDOWN_TURNS, MAGIC_DAMAGE, BASE_ATTACK_DAMAGE } from "../../lib/descentConfig";

const DescentArena = dynamic(() => import("./DescentArena"), { ssr: false });

const FONT = "'Noto Serif JP', 'Hiragino Mincho ProN', serif";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Float = { id: number; who: "player" | "enemy"; text: string; color: string };
type Log = { id: number; text: string; tone: string };

type Props = { run: Run; onRun: (r: Run) => void; onAbandon: () => void };

export default function DescentBattle({ run, onRun, onAbandon }: Props) {
  const biome = biomeOf(run);
  const enemy = currentEnemy(run);
  const [busy, setBusy] = useState(false);
  const [pAnim, setPAnim] = useState<{ anim: DescentAnim; key: number }>({ anim: "idle", key: 0 });
  const [eAnim, setEAnim] = useState<{ anim: DescentAnim; key: number }>({ anim: "idle", key: 0 });
  const [pDead, setPDead] = useState(false);
  const [eDead, setEDead] = useState(false);
  const [dispHp, setDispHp] = useState({ p: run.player.hp, e: enemy?.hp ?? 0 });
  const [floats, setFloats] = useState<Float[]>([]);
  const [log, setLog] = useState<Log[]>([]);
  const [shake, setShake] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const idRef = useRef(1);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

  // keep displayed HP in sync when not animating (new floor / new enemy / rewards)
  useEffect(() => { if (!busy) setDispHp({ p: run.player.hp, e: enemy?.hp ?? 0 }); }, [run, busy, enemy]);

  const pushLog = useCallback((text: string, tone = "info") => setLog((l) => [...l.slice(-5), { id: idRef.current++, text, tone }]), []);
  const float = useCallback((who: "player" | "enemy", text: string, color: string) => {
    const id = idRef.current++;
    setFloats((f) => [...f, { id, who, text, color }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1100);
  }, []);

  // ── floor intro
  useEffect(() => {
    if (run.phase !== "intro") return;
    setEDead(false); setPDead(false);
    setBanner(`FLOOR ${run.floor} · ${biome.name}`);
    const t = setTimeout(() => { setBanner(null); onRun(beginBattle(run)); pushLog(`${enemy?.name ?? "The hive"} steps forward`, "info"); }, 1900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.phase, run.floor]);

  // ── play an engine event list
  const playEvents = useCallback(async (evs: Ev[], next: Run) => {
    let enemyName = enemy?.name ?? "";
    for (const ev of evs) {
      if (ev.t === "anim") {
        if (ev.who === "player") setPAnim((a) => ({ anim: ev.anim, key: a.key + 1 })); else setEAnim((a) => ({ anim: ev.anim, key: a.key + 1 }));
        if (ev.anim === "lose") { if (ev.who === "player") setPDead(true); else setEDead(true); }
        await sleep(ev.ms ?? (ev.anim === "attack" || ev.anim === "magic" || ev.anim === "trick" ? 650 : 400));
      } else if (ev.t === "dmg") {
        if (ev.kind === "dodge") { float("player", "DODGE", "#67e8f9"); await sleep(350); continue; }
        const color = ev.who === "player" ? "#f87171" : ev.crit ? "#fde68a" : ev.kind === "burn" ? "#fb923c" : ev.kind === "poison" ? "#a3e635" : "#ffffff";
        const label = (ev.crit ? "CRIT " : "") + `-${ev.amount}` + (ev.kind === "blocked" ? " (blocked)" : ev.kind === "burn" ? " 🔥" : ev.kind === "poison" ? " ☠" : "");
        float(ev.who, label, color);
        setDispHp((h) => ({ ...h, [ev.who === "player" ? "p" : "e"]: Math.max(0, (ev.who === "player" ? h.p : h.e) - ev.amount) }));
        if (ev.who === "player") { setShake(ev.amount > 20 ? 1.6 : 1); setFlash("rgba(255,40,60,0.35)"); }
        else { setShake(ev.crit ? 1.2 : 0.6); if (ev.amount > 0 && !ev.kind) setEAnim((a) => ({ anim: "hit", key: a.key + 1 })); }
        setTimeout(() => { setShake(0); setFlash(null); }, 260);
        await sleep(ev.kind === "burn" || ev.kind === "poison" ? 320 : 420);
      } else if (ev.t === "heal") { float(ev.who, `+${ev.amount}`, "#4ade80"); setDispHp((h) => ({ ...h, [ev.who === "player" ? "p" : "e"]: (ev.who === "player" ? h.p : h.e) + ev.amount })); await sleep(300); }
      else if (ev.t === "text") { pushLog(ev.text, ev.tone ?? "info"); await sleep(180); }
      else if (ev.t === "enemyDown") { pushLog(`${ev.name} destroyed · +${ev.rebel} REBEL`, "good"); await sleep(1000); enemyName = ""; }
      else if (ev.t === "floorClear") { pushLog(`Floor ${ev.floor} cleared`, "boom"); setFlash("rgba(255,255,255,0.35)"); setTimeout(() => setFlash(null), 300); await sleep(900); }
      else if (ev.t === "playerDown") { if (ev.revived) { setPDead(false); setPAnim((a) => ({ anim: "idle", key: a.key + 1 })); } await sleep(ev.revived ? 900 : 1400); }
    }
    void enemyName;
    // next enemy on the same floor?
    const ne = currentEnemy(next);
    if (next.phase === "battle" && ne && enemy && (ne !== enemy) && ne.turn === 0) { setEDead(false); setEAnim({ anim: "idle", key: 0 }); pushLog(`${ne.name} steps forward`, "info"); }
    setPAnim((a) => (a.anim === "lose" ? a : { anim: "idle", key: a.key + 1 }));
    onRun(next);
    setBusy(false);
  }, [enemy, float, pushLog, onRun]);

  const act = useCallback((action: Action) => {
    if (busy || run.phase !== "battle") return;
    if (action === "special" && run.player.specialCd > 0) return;
    if (action === "magic" && run.player.magicCd > 0) return;
    setBusy(true);
    const { run: next, evs } = takeTurn(run, action);
    void playEvents(evs, next);
  }, [busy, run, playEvents]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { const k = e.key; if (k === "1") act("attack"); else if (k === "2") act("defend"); else if (k === "3") act("special"); else if (k === "4") act("magic"); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [act]);

  const p = run.player;
  const playerActor: ArenaActor = { factionId: run.factionId, anim: pAnim.anim, animKey: pAnim.key, dead: pDead };
  const enemyActor: ArenaActor | null = enemy ? { factionId: enemy.factionId, anim: eAnim.anim, animKey: eAnim.key, dead: eDead, scale: enemy.scale, corrupted: true } : null;
  const hpPct = Math.max(0, Math.min(1, dispHp.p / p.maxHp));
  const ehpPct = enemy ? Math.max(0, Math.min(1, dispHp.e / enemy.maxHp)) : 0;
  const hpColor = hpPct > 0.55 ? "#4ade80" : hpPct > 0.28 ? "#fbbf24" : "#f87171";
  const specialReady = p.specialCd === 0, magicReady = p.magicCd === 0;
  const intent = enemy?.intent;
  const intentColor = intent?.kind === "heavy" ? "#fb923c" : intent?.kind === "special" ? "#ff3399" : intent?.kind === "guard" ? "#67e8f9" : "#f87171";

  const btn = (label: string, sub: string, key: string, color: string, ready: boolean, onClick: () => void, badge?: string) => (
    <button type="button" disabled={busy || !ready || run.phase !== "battle"} onClick={onClick}
      style={{ flex: 1, minWidth: 0, fontFamily: FONT, padding: isMobile ? "10px 6px" : "12px 10px", borderRadius: 14, border: `1px solid ${ready ? color + "88" : "rgba(255,255,255,0.12)"}`, background: ready ? `linear-gradient(180deg, ${color}26, rgba(0,0,0,0.55))` : "rgba(0,0,0,0.5)", color: ready ? "#fff" : "rgba(255,255,255,0.35)", cursor: busy || !ready ? "not-allowed" : "pointer", boxShadow: ready && !busy ? `0 0 18px ${color}44` : "none", position: "relative", textAlign: "center", opacity: busy ? 0.7 : 1, transition: "all .15s" }}>
      <div style={{ fontSize: isMobile ? 12 : 14, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: isMobile ? 9 : 10, opacity: 0.7, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
      {!isMobile && <div style={{ position: "absolute", top: 6, left: 8, fontSize: 9, opacity: 0.4, fontFamily: "monospace" }}>{key}</div>}
      {badge && <div style={{ position: "absolute", top: 6, right: 8, fontSize: 10, fontWeight: 900, color, fontFamily: "monospace" }}>{badge}</div>}
    </button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", color: "#fff", overflow: "hidden", fontFamily: FONT }}>
      <DescentArena biome={biome} player={playerActor} enemy={enemyActor} shake={shake} flash={flash} />

      {/* floating numbers */}
      {floats.map((f) => (
        <div key={f.id} style={{ position: "absolute", left: f.who === "player" ? "30%" : "70%", top: "38%", transform: "translateX(-50%)", color: f.color, fontWeight: 900, fontSize: f.text.startsWith("CRIT") ? 34 : 26, textShadow: "0 2px 12px #000, 0 0 20px " + f.color, animation: "hdFloat 1.1s ease-out both", pointerEvents: "none", whiteSpace: "nowrap" }}>{f.text}</div>
      ))}

      {/* top HUD */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: `calc(env(safe-area-inset-top, 0px) + 10px) 12px 8px`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, background: "linear-gradient(180deg, rgba(0,0,0,0.7), transparent)", pointerEvents: "none" }}>
        <div style={{ pointerEvents: "auto" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.3em", color: biome.particleColor, fontWeight: 700 }}>FLOOR {run.floor} / {DESCENT_TOTAL_FLOORS} · {biome.name.toUpperCase()}</div>
          <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: "0.1em", marginTop: 2 }}>🐜 {run.faction.name.toUpperCase()}</div>
          {run.relics.length > 0 && (
            <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap", maxWidth: 260 }}>
              {run.relics.map((r) => (<span key={r.id} title={`${r.name} — ${r.flavor}`} style={{ fontSize: 9, letterSpacing: "0.08em", padding: "2px 7px", borderRadius: 999, border: `1px solid ${getRarityColor(r.rarity)}88`, color: getRarityColor(r.rarity), background: "rgba(0,0,0,0.5)" }}>{r.name}</span>))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", pointerEvents: "auto" }}>
          <div style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 900, color: "#fbbf24", letterSpacing: "0.06em" }}>💎 +{run.unbanked}</div>
          <button type="button" onClick={onAbandon} style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(248,113,113,0.4)", borderRadius: 999, padding: "6px 10px", color: "#f87171", fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", cursor: "pointer", fontFamily: FONT }}>✕ ABANDON</button>
        </div>
      </div>

      {/* enemy plate */}
      {enemy && (
        <div style={{ position: "absolute", top: isMobile ? 84 : 92, right: 14, width: isMobile ? "min(46vw, 230px)" : 260, pointerEvents: "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: enemy.isBoss ? 14 : 12, fontWeight: 900, letterSpacing: "0.12em", color: enemy.isBoss ? "#ff3399" : "#fff", textShadow: "0 1px 6px #000" }}>{enemy.name.toUpperCase()}</div>
            <div style={{ fontSize: 10, opacity: 0.7, fontFamily: "monospace" }}>{Math.ceil(dispHp.e)}/{enemy.maxHp}</div>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "rgba(0,0,0,0.65)", border: "1px solid rgba(255,255,255,0.15)", overflow: "hidden", marginTop: 4 }}>
            <div style={{ width: `${ehpPct * 100}%`, height: "100%", background: `linear-gradient(90deg, #ff3399, ${biome.particleColor})`, transition: "width .35s" }} />
          </div>
          {(enemy.burn > 0 || enemy.poison > 0 || enemy.stunned > 0) && <div style={{ marginTop: 4, fontSize: 9, letterSpacing: "0.1em", opacity: 0.85 }}>{enemy.burn > 0 ? "🔥 BURNING  " : ""}{enemy.poison > 0 ? "☠ POISONED  " : ""}{enemy.stunned > 0 ? "💫 STUNNED" : ""}</div>}
          {intent && run.phase === "battle" && (
            <div style={{ marginTop: 8, padding: "7px 10px", borderRadius: 10, background: "rgba(0,0,0,0.65)", border: `1px solid ${intentColor}66`, boxShadow: `0 0 14px ${intentColor}33` }}>
              <div style={{ fontSize: 9, letterSpacing: "0.25em", color: intentColor, fontWeight: 700 }}>NEXT MOVE</div>
              <div style={{ fontSize: 12, fontWeight: 900, marginTop: 1 }}>{intent.label}</div>
              <div style={{ fontSize: 10, opacity: 0.7, marginTop: 1 }}>{intent.hint}</div>
            </div>
          )}
        </div>
      )}

      {/* log */}
      <div style={{ position: "absolute", left: 14, bottom: isMobile ? 132 : 150, width: "min(44vw, 340px)", pointerEvents: "none", display: "flex", flexDirection: "column", gap: 2 }}>
        {log.map((l, i) => (<div key={l.id} style={{ fontSize: isMobile ? 10 : 11, color: l.tone === "good" ? "#86efac" : l.tone === "bad" ? "#fca5a5" : l.tone === "boom" ? "#fde68a" : "rgba(255,255,255,0.75)", opacity: 0.35 + ((i + 1) / log.length) * 0.65, textShadow: "0 1px 3px #000", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.text}</div>))}
      </div>

      {/* bottom: HP + actions */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: `10px 12px calc(env(safe-area-inset-bottom, 0px) + 12px)`, background: "linear-gradient(0deg, rgba(0,0,0,0.85), rgba(0,0,0,0.4) 70%, transparent)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.25em", fontWeight: 700, color: hpColor }}>HP · {Math.ceil(dispHp.p)} / {p.maxHp}</div>
          <div style={{ fontSize: 9, letterSpacing: "0.15em", opacity: 0.55 }}>DMG ×{(p.dmgMult * p.buffMult).toFixed(2)} · CRIT {Math.round(p.critChance * 100)}%{p.buffTurns > 0 ? ` · RALLY ${p.buffTurns}` : ""}</div>
        </div>
        <div style={{ height: 12, borderRadius: 6, background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.15)", overflow: "hidden", marginBottom: 10 }}>
          <div style={{ width: `${hpPct * 100}%`, height: "100%", background: `linear-gradient(90deg, ${hpColor}, ${hpColor}99)`, boxShadow: `0 0 12px ${hpColor}88`, transition: "width .35s, background .3s" }} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {btn("Attack", `${BASE_ATTACK_DAMAGE} dmg`, "1", "#f87171", true, () => act("attack"))}
          {btn("Defend", "take 35% · +5 HP", "2", "#67e8f9", true, () => act("defend"))}
          {btn(run.faction.specialName, run.faction.blurb.split(".")[0], "3", "#fbbf24", specialReady, () => act("special"), specialReady ? "READY" : `${p.specialCd}`)}
          {btn("Magic", `${MAGIC_DAMAGE} dmg · ignores guard`, "4", "#c084fc", magicReady, () => act("magic"), magicReady ? undefined : `${p.magicCd}`)}
        </div>
        {!isMobile && <div style={{ fontSize: 9, opacity: 0.35, letterSpacing: "0.2em", marginTop: 6, textAlign: "center" }}>KEYS 1 · 2 · 3 · 4 — SPECIAL RECHARGES IN {specialCooldownTurns(p)} TURNS, MAGIC IN {MAGIC_COOLDOWN_TURNS}</div>}
      </div>

      {/* floor banner */}
      {banner && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", background: "rgba(0,0,0,0.35)" }}>
          <div style={{ textAlign: "center", animation: "hdBanner 1.9s ease-out both" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.5em", color: biome.particleColor }}>{biome.kind === "final_boss" ? "◆ FINAL FLOOR ◆" : biome.kind === "mini_boss" ? "◆ BOSS FLOOR ◆" : "◆ DESCENDING ◆"}</div>
            <div style={{ fontSize: "clamp(28px, 6vw, 60px)", fontWeight: 900, letterSpacing: "0.12em", marginTop: 8, textShadow: `0 0 40px ${biome.particleColor}` }}>{banner}</div>
            <div style={{ fontSize: 13, opacity: 0.75, fontStyle: "italic", marginTop: 8 }}>{biome.subtitle}</div>
          </div>
        </div>
      )}

      {/* reward overlay */}
      {run.phase === "reward" && !busy && (
        <RewardOverlay run={run} onPick={(o) => onRun(chooseReward(run, o))} />
      )}

      <style>{`
        @keyframes hdFloat{0%{transform:translate(-50%,0) scale(.7);opacity:0}15%{transform:translate(-50%,-10px) scale(1.15);opacity:1}100%{transform:translate(-50%,-70px) scale(1);opacity:0}}
        @keyframes hdBanner{0%{opacity:0;transform:scale(.8) translateY(10px)}15%{opacity:1;transform:scale(1) translateY(0)}80%{opacity:1}100%{opacity:0;transform:scale(1.05)}}
        @keyframes hdCard{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
      `}</style>
    </div>
  );
}

function RewardOverlay({ run, onPick }: { run: Run; onPick: (o: RewardOffer) => void }) {
  const [sel, setSel] = useState<number | null>(null);
  const colorFor = (o: RewardOffer) => o.kind === "heal" ? "#4ade80" : o.kind === "power" ? "#f87171" : o.kind === "cashout" ? "#fbbf24" : getRarityColor(o.relic!.rarity);
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.78)", backdropFilter: "blur(6px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16, overflowY: "auto" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.5em", color: "#fbbf24" }}>FLOOR {run.floor} CLEARED · +{run.unbanked} REBEL UNBANKED</div>
      <div style={{ fontSize: "clamp(22px,4vw,36px)", fontWeight: 900, letterSpacing: "0.1em", marginTop: 8, textAlign: "center" }}>CHOOSE YOUR BOON</div>
      <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6, textAlign: "center" }}>HP {run.player.hp}/{run.player.maxHp} · Next: {run.floor + 1 <= DESCENT_TOTAL_FLOORS ? `Floor ${run.floor + 1}` : "—"}</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(170px, 1fr))`, gap: 12, width: "100%", maxWidth: 820, marginTop: 22 }}>
        {run.rewardOffers.map((o, i) => {
          const c = colorFor(o); const isSel = sel === i;
          return (
            <button key={i} type="button" onClick={() => setSel(i)} style={{ animation: `hdCard .4s ${i * 0.08}s ease-out both`, textAlign: "left", fontFamily: FONT, padding: 16, borderRadius: 16, border: `1px solid ${isSel ? c : c + "55"}`, background: isSel ? `linear-gradient(180deg, ${c}33, rgba(0,0,0,0.6))` : "rgba(0,0,0,0.5)", color: "#fff", cursor: "pointer", boxShadow: isSel ? `0 0 30px ${c}66` : "none", transform: isSel ? "translateY(-4px)" : "none", transition: "all .15s" }}>
              <div style={{ fontSize: 9, letterSpacing: "0.3em", color: c, fontWeight: 700 }}>{o.kind === "relic" ? o.relic!.rarity.toUpperCase() + " RELIC" : o.kind.toUpperCase()}</div>
              <div style={{ fontSize: 17, fontWeight: 900, marginTop: 6, letterSpacing: "0.04em" }}>{o.title}</div>
              <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6, fontStyle: o.kind === "relic" ? "italic" : "normal", lineHeight: 1.45 }}>{o.desc}</div>
              {o.kind === "relic" && <div style={{ fontSize: 10, marginTop: 8, color: c, opacity: 0.9 }}>{describeRelic(o)}</div>}
            </button>
          );
        })}
      </div>
      <button type="button" disabled={sel === null} onClick={() => sel !== null && onPick(run.rewardOffers[sel])} style={{ marginTop: 22, fontFamily: FONT, padding: "14px 36px", borderRadius: 999, border: "none", background: sel === null ? "rgba(255,255,255,0.1)" : "linear-gradient(135deg,#ff3399,#aa0066)", color: "#fff", fontSize: 14, fontWeight: 900, letterSpacing: "0.2em", cursor: sel === null ? "not-allowed" : "pointer", boxShadow: sel === null ? "none" : "0 0 30px rgba(255,51,153,0.5)" }}>
        {sel !== null && run.rewardOffers[sel].kind === "cashout" ? "⚑ ESCAPE WITH THE LOOT" : "⚔ DESCEND"}
      </button>
    </div>
  );
}

function describeRelic(o: RewardOffer): string {
  const e = o.relic!.effect; const parts: string[] = [];
  if (e.damageMult) parts.push(`+${Math.round((e.damageMult - 1) * 100)}% dmg`);
  if (e.maxHpAdd) parts.push(`${e.maxHpAdd > 0 ? "+" : ""}${e.maxHpAdd} max HP`);
  if (e.critChanceAdd) parts.push(`+${Math.round(e.critChanceAdd * 100)}% crit`);
  if (e.critDamageAdd) parts.push(`+${Math.round(e.critDamageAdd * 100)}% crit dmg`);
  if (e.healOnKill) parts.push(`+${e.healOnKill} HP per kill`);
  if (e.ignite) parts.push("attacks burn");
  if (e.reviveOnce) parts.push("revive once at 50%");
  if (e.dodgeIframesAdd) parts.push(`+${Math.round(e.dodgeIframesAdd / 20)}% dodge`);
  if (e.speedMult) parts.push(`+${Math.round((e.speedMult - 1) * 50)}% dodge`);
  if (e.attackSpeedMult) parts.push(`${Math.round((e.attackSpeedMult - 1) * 100)}% follow-up hit`);
  if (e.specialCooldownMult) parts.push("faster special");
  if (e.rebelGainMult) parts.push(`+${Math.round((e.rebelGainMult - 1) * 100)}% REBEL`);
  return parts.join(" · ");
}
