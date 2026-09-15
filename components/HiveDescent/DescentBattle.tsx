// components/HiveDescent/DescentBattle.tsx
// Hive Descent v3 battle UI: card hand + energy on top of the over-the-shoulder stage.
// Drives the pure engine, animates its events, offers boons between floors.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ArenaAnim } from "../arena/ArenaCharacter";
import type { StageActor, StageFx } from "./DescentStage";
import { enemySlots, PLAYER_POS, FX_LIFE } from "./DescentStage";
import { biomeOf, beginBattle, playCard, endTurn, chooseReward, canPlay, cardCost, aliveEnemies, HEAL_REWARD, type Run, type Ev, type RewardOffer, type Enemy, type Who } from "./descentEngine";
import { getRarityColor } from "./relics";
import { rarityColor, POWERS, type Card } from "../../lib/descentCards";
import { DESCENT_TOTAL_FLOORS } from "../../lib/descentConfig";
import { useDescentAudio } from "../../lib/useDescentAudio";

const DescentStage = dynamic(() => import("./DescentStage"), { ssr: false });

const FONT = "'Noto Serif JP', 'Hiragino Mincho ProN', serif";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// swing → contact, from the measured contact frames minus CLIP_OFFSETS, over the actor's clip speed (player 1.25×, enemy 1.15×)
const IMPACT: Record<string, number> = { "player:attack": 440, "player:magic": 480, "player:trick": 300, "enemy:attack": 480, "enemy:magic": 520, "enemy:trick": 320 };

type Float = { id: number; who: "player" | number; text: string; color: string; big?: boolean };
type Log = { id: number; text: string; tone: string };
type AnimState = { anim: ArenaAnim; key: number };

type Props = { run: Run; onRun: (r: Run) => void; onAbandon: () => void };

const TYPE_COLOR: Record<Card["type"], string> = { attack: "#f87171", skill: "#67e8f9", power: "#c084fc" };
const TUT_KEY = "ra:hd:tut:v1";

export default function DescentBattle({ run, onRun, onAbandon }: Props) {
  const biome = biomeOf(run);
  const alive = aliveEnemies(run);
  const [busy, setBusy] = useState(false);
  const [pAnim, setPAnim] = useState<AnimState>({ anim: "idle", key: 0 });
  const [eAnims, setEAnims] = useState<Record<number, AnimState>>({});
  const [flashes, setFlashes] = useState<Record<string, number>>({});
  const [dead, setDead] = useState<Record<string, boolean>>({});
  const [dispHp, setDispHp] = useState<Record<string, number>>({});
  const [dispBlock, setDispBlock] = useState<Record<string, number>>({});
  const [floats, setFloats] = useState<Float[]>([]);
  const [fx, setFx] = useState<StageFx[]>([]);
  const [log, setLog] = useState<Log[]>([]);
  const [shake, setShake] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [showPile, setShowPile] = useState<"draw" | "discard" | "exhaust" | null>(null);
  const [dissolve, setDissolve] = useState<Record<string, number>>({});   // enemy id → when it started disintegrating
  const [gone, setGone] = useState<Record<string, boolean>>({});          // fully disintegrated → unmounted
  const audio = useDescentAudio();
  const [showHelp, setShowHelp] = useState(false);
  const helpShown = useRef(false);
  const lowHpFired = useRef(false);
  const speedRef = useRef(1);
  const idRef = useRef(1);
  const timers = useRef<number[]>([]);
  const later = useCallback((ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); }, []);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

  // displayed HP/block follow the run when not animating
  useEffect(() => {
    if (busy) return;
    const hp: Record<string, number> = { player: run.player.hp }; const bl: Record<string, number> = { player: run.player.block };
    run.enemies.forEach((e) => { hp[e.id] = e.hp; bl[e.id] = e.block; });
    setDispHp(hp); setDispBlock(bl);
  }, [run, busy]);

  // default target = first living enemy
  useEffect(() => { if (targetId == null || !alive.some((e) => e.id === targetId)) setTargetId(alive[0]?.id ?? null); }, [alive, targetId]);

  const pushLog = useCallback((text: string, tone = "info") => setLog((l) => [...l.slice(-5), { id: idRef.current++, text, tone }]), []);
  const float = useCallback((who: "player" | number, text: string, color: string, big = false) => {
    const id = idRef.current++;
    setFloats((f) => [...f, { id, who, text, color, big }]);
    later(1100, () => setFloats((f) => f.filter((x) => x.id !== id)));
  }, [later]);
  const spawnFx = useCallback((kind: StageFx["kind"], who: Who, color: string) => {
    const id = idRef.current++; const life = FX_LIFE[kind];
    let x = PLAYER_POS[0], z = PLAYER_POS[2];
    if (who !== "player") { const idx = run.enemies.findIndex((e) => e.id === who.enemy); const s = enemySlots(run.enemies.length)[Math.max(0, idx)]; if (s) { x = s[0]; z = s[2]; } }
    setFx((f) => [...f, { id, kind, x, z, color, t0: performance.now(), life }]);
    later(life + 50, () => setFx((f) => f.filter((v) => v.id !== id)));
  }, [later, run]);
  const playAnim = useCallback((who: Who, anim: ArenaAnim) => {
    if (who === "player") setPAnim((a) => ({ anim, key: a.key + 1 }));
    else setEAnims((m) => ({ ...m, [who.enemy]: { anim, key: (m[who.enemy]?.key || 0) + 1 } }));
  }, []);
  const hitFlash = useCallback((who: Who) => { const k = who === "player" ? "player" : String(who.enemy); setFlashes((f) => ({ ...f, [k]: (f[k] || 0) + 1 })); }, []);
  const hitStop = useCallback((ms = 80) => { speedRef.current = 0.02; later(ms, () => { speedRef.current = 1; }); }, [later]);

  // ── floor intro
  useEffect(() => {
    if (run.phase !== "intro") return;
    setDead({}); setEAnims({}); setPAnim({ anim: "idle", key: 0 }); setSelected(null); setDissolve({}); setGone({}); lowHpFired.current = false;
    setBanner(`FLOOR ${run.floor} · ${biome.name}`);
    audio.music("hd-war", biome.kind === "combat" ? 0.38 : 0.48);
    if (biome.kind !== "combat") audio.sfx.ambush();
    const t = setTimeout(() => { setBanner(null); const r = beginBattle(run); onRun(r.run); pushLog(`${aliveEnemies(r.run).map((e) => e.name).join(", ")} — ${aliveEnemies(r.run).length > 1 ? "step forward" : "steps forward"}`, "info"); }, 1900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.phase, run.floor]);

  // first-ever battle: explain the hand before the first card is played
  useEffect(() => {
    if (run.phase !== "battle" || helpShown.current) return;
    helpShown.current = true;
    try { if (localStorage.getItem(TUT_KEY) !== "1") setShowHelp(true); } catch {}
  }, [run.phase]);
  const closeHelp = useCallback(() => { setShowHelp(false); try { localStorage.setItem(TUT_KEY, "1"); } catch {} }, []);

  // ── event playback
  const playEvents = useCallback(async (evs: Ev[], opts: { fast?: boolean } = {}) => {
    const f = opts.fast ? 0.55 : 1;
    const key = (w: Who) => (w === "player" ? "player" : String(w.enemy));
    for (const ev of evs) {
      switch (ev.t) {
        case "play": pushLog(`${ev.card.name}`, ev.card.type === "attack" ? "bad" : "info"); break;
        case "anim": {
          playAnim(ev.who, ev.anim);
          if (ev.anim === "lose") setDead((d) => ({ ...d, [key(ev.who)]: true }));
          if (ev.anim === "magic") audio.sfx.magic(); else if (ev.anim === "trick") audio.sfx.trick(); else if (ev.anim === "defend") audio.sfx.block();
          if (ev.anim === "attack" || ev.anim === "magic" || ev.anim === "trick") await sleep(IMPACT[`${ev.who === "player" ? "player" : "enemy"}:${ev.anim}`] ?? 400);
          else if (ev.anim === "defend") { spawnFx("dome", ev.who, ev.who === "player" ? "#67e8f9" : biome.particleColor); await sleep(200 * f); }
          else if (ev.anim === "lose") await sleep(150 * f);
          break;
        }
        case "dmg": {
          const k = key(ev.who);
          const total = ev.amount + ev.blocked;
          if (ev.kind === "poison") { float(ev.who === "player" ? "player" : ev.who.enemy, `☠ -${ev.amount}`, "#a3e635"); spawnFx("poison", ev.who, "#a3e635"); }
          else if (ev.kind === "burn") float(ev.who === "player" ? "player" : ev.who.enemy, `🔥 -${ev.amount}`, "#fb923c");
          else if (ev.kind === "thorns") float(ev.who === "player" ? "player" : ev.who.enemy, `⚘ -${ev.amount}`, "#f472b6");
          else if (ev.kind === "self") float("player", `-${ev.amount}`, "#f87171");
          else {
            const big = ev.amount >= 15;
            const txt = ev.amount === 0 && ev.blocked > 0 ? "BLOCKED" : `${ev.crit ? "CRIT " : ""}-${ev.amount}${ev.blocked > 0 ? ` (${ev.blocked} blocked)` : ""}`;
            float(ev.who === "player" ? "player" : ev.who.enemy, txt, ev.who === "player" ? "#f87171" : ev.crit ? "#fde68a" : ev.amount === 0 ? "#9ca3af" : "#ffffff", big);
            if (ev.who !== "player") { spawnFx("slash", ev.who, "#ffffff"); spawnFx("sparks", ev.who, biome.particleColor); }
            else { spawnFx("sparks", "player", "#ff6b6b"); }
            if (total > 0) { hitFlash(ev.who); hitStop(big ? 110 : 70); setShake(ev.who === "player" ? (big ? 1.6 : 1) : big ? 1.1 : 0.6); if (ev.who === "player") audio.sfx.playerHit(); else if (big) audio.sfx.heavy(); else audio.sfx.hit(); if (ev.amount === 0 && ev.blocked > 0) audio.sfx.block(); }
            if (ev.who === "player" && ev.amount > 0) setFlash("rgba(255,40,60,0.3)");
            if (ev.who !== "player" && ev.amount > 0) playAnim(ev.who, "hit");
            later(240, () => { setShake(0); setFlash(null); });
          }
          setDispBlock((b) => ({ ...b, [k]: Math.max(0, (b[k] ?? 0) - ev.blocked) }));
          setDispHp((h) => ({ ...h, [k]: Math.max(0, (h[k] ?? 0) - ev.amount) }));
          await sleep((ev.kind ? 260 : 380) * f);
          break;
        }
        case "dodge": float("player", "DODGE", "#67e8f9"); await sleep(300 * f); break;
        case "block": { const k = key(ev.who); setDispBlock((b) => ({ ...b, [k]: (b[k] ?? 0) + ev.amount })); float(ev.who === "player" ? "player" : ev.who.enemy, `🛡 +${ev.amount}`, "#67e8f9"); await sleep(220 * f); break; }
        case "heal": { const k = key(ev.who); setDispHp((h) => ({ ...h, [k]: (h[k] ?? 0) + ev.amount })); float(ev.who === "player" ? "player" : ev.who.enemy, `+${ev.amount}`, "#4ade80"); await sleep(260 * f); break; }
        case "status": { const label = ev.status === "energy" ? `⚡ +${ev.amount}` : POWERS[ev.status] ? POWERS[ev.status].name : `${ev.status} +${ev.amount}`; float(ev.who === "player" ? "player" : ev.who.enemy, label, ev.who === "player" ? "#fbbf24" : "#c084fc"); if (ev.status === "poison") spawnFx("poison", ev.who, "#a3e635"); if (POWERS[ev.status]) spawnFx("glyph", "player", "#c084fc"); await sleep(220 * f); break; }
        case "draw": await sleep(120 * f); break;
        case "text": pushLog(ev.text, ev.tone ?? "info"); await sleep(160 * f); break;
        case "turn": if (ev.n > 1) pushLog(`— turn ${ev.n} —`, "info"); break;
        case "enemyDown": { pushLog(`${ev.name} destroyed · +${ev.rebel} REBEL`, "good"); audio.sfx.enemyDie(); const id = ev.enemy; later(350, () => { setDissolve((d) => ({ ...d, [String(id)]: performance.now() })); spawnFx("dissolve", { enemy: id }, biome.particleColor); }); later(1900, () => setGone((g) => ({ ...g, [String(id)]: true }))); await sleep(900); break; }
        case "floorClear": await sleep(1100); pushLog(`Floor ${ev.floor} cleared`, "boom"); audio.sfx.floorClear(); setFlash("rgba(255,255,255,0.35)"); later(300, () => setFlash(null)); await sleep(1000); break;
        case "playerDown": if (ev.revived) { audio.sfx.rally(); setDead((d) => ({ ...d, player: false })); setPAnim((a) => ({ anim: "idle", key: a.key + 1 })); } else { audio.music(null); audio.sfx.lose(); } await sleep(ev.revived ? 900 : 2400); break;
      }
    }
  }, [biome.particleColor, float, hitFlash, hitStop, later, playAnim, pushLog, spawnFx, audio]);

  // ── actions
  const doPlay = useCallback((idx: number) => {
    if (busy || run.phase !== "battle" || !canPlay(run, idx)) return;
    const card = run.hand[idx];
    const tgt = card.target === "enemy" ? (targetId ?? alive[0]?.id ?? null) : null;
    const { run: next, evs } = playCard(run, idx, tgt);
    if (next === run) return;
    setSelected(null);
    setBusy(true); audio.sfx.card();
    if (next.phase === "battle") onRun(next);   // hand + energy update instantly; visuals catch up
    void (async () => { await playEvents(evs, { fast: true }); if (next.phase !== "battle") onRun(next); setBusy(false); })();
  }, [busy, run, targetId, alive, onRun, playEvents, audio]);

  const doEndTurn = useCallback(() => {
    if (busy || run.phase !== "battle") return;
    const { run: next, evs } = endTurn(run);
    setBusy(true); setSelected(null);
    void (async () => {
      pushLog("Enemy turn", "bad"); audio.sfx.deselect();
      await playEvents(evs);
      onRun(next);
      setBusy(false);
    })();
  }, [busy, run, onRun, playEvents, pushLog, audio]);

  // once the hand is spent the enemies act on their own — END TURN is only for passing early
  useEffect(() => {
    if (busy || run.phase !== "battle" || showHelp) return;
    if (run.hand.some((_, i) => canPlay(run, i))) return;
    const t = window.setTimeout(() => doEndTurn(), 750);
    return () => clearTimeout(t);
  }, [busy, run, doEndTurn, showHelp]);

  const onCardClick = useCallback((idx: number) => {
    if (busy) return;
    const card = run.hand[idx];
    if (!canPlay(run, idx)) return;
    if (card.target === "enemy" && alive.length > 1 && selected !== idx) { setSelected(idx); return; }  // pick a target next
    doPlay(idx);
  }, [busy, run, alive.length, selected, doPlay]);

  const onPickTarget = useCallback((id: number) => {
    setTargetId(id);
    if (selected != null) { const idx = selected; setSelected(null); if (canPlay(run, idx)) { const { run: next, evs } = playCard(run, idx, id); if (next !== run) { setBusy(true); audio.sfx.card(); if (next.phase === "battle") onRun(next); void (async () => { await playEvents(evs, { fast: true }); if (next.phase !== "battle") onRun(next); setBusy(false); })(); } } }
  }, [selected, run, onRun, playEvents, audio]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (showHelp) { if (e.key === "Escape" || e.key === "Enter") closeHelp(); return; } if (e.key === "e" || e.key === "Enter") doEndTurn(); const n = parseInt(e.key, 10); if (n >= 1 && n <= run.hand.length) onCardClick(n - 1); if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [doEndTurn, onCardClick, run.hand.length, showHelp, closeHelp]);

  // ── stage props
  const p = run.player;
  const playerActor: StageActor = { id: -1, factionId: run.factionId, anim: pAnim.anim, animKey: pAnim.key, dead: !!dead.player, scale: 1, flashKey: flashes.player || 0, pos: PLAYER_POS };
  const slots = enemySlots(run.enemies.length);
  const enemyActors: StageActor[] = run.enemies.map((e, i) => ({ e, i })).filter(({ e }) => (e.alive || dead[String(e.id)]) && !gone[String(e.id)]).map(({ e, i }) => ({ id: e.id, factionId: e.factionId, anim: eAnims[e.id]?.anim ?? "idle", animKey: eAnims[e.id]?.key ?? 0, dead: !!dead[String(e.id)] || !e.alive, scale: e.scale, flashKey: flashes[String(e.id)] || 0, pos: slots[i], dissolveAt: dissolve[String(e.id)] ?? null }));
  const enemyById = useMemo(() => Object.fromEntries(run.enemies.map((e) => [e.id, e])) as Record<number, Enemy>, [run.enemies]);

  const renderEnemyLabel = useCallback((id: number) => {
    const e = enemyById[id]; if (!e || !e.alive) return null;
    const hp = dispHp[String(id)] ?? e.hp; if (hp <= 0) return null; const bl = dispBlock[String(id)] ?? e.block; const pct = Math.max(0, Math.min(1, hp / e.maxHp));
    const isT = id === targetId;
    const statuses = [e.poison > 0 && `☠${e.poison}`, e.burn > 0 && `🔥${e.burn}`, e.stun > 0 && `💫${e.stun}`, e.vulnerable > 0 && `▼${e.vulnerable}`, e.weak > 0 && `≈${e.weak}`, e.strength > 0 && `↑${e.strength}`].filter(Boolean) as string[];
    return (
      <div style={{ width: 168, fontFamily: FONT, textAlign: "center", transform: "translateY(-6px)", filter: isT ? "drop-shadow(0 0 10px #ffd166aa)" : "none" }}>
        <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", color: isT ? "#ffd166" : "#fff", textShadow: "0 1px 6px #000" }}>{e.isBoss ? "☠ " : ""}{e.name.toUpperCase()}</div>
        <div style={{ margin: "4px auto 0", height: 6, width: 120, background: "rgba(0,0,0,0.6)", borderRadius: 4, overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)" }}>
          <div style={{ height: "100%", width: `${pct * 100}%`, background: `linear-gradient(90deg, ${biome.particleColor}, #ff3366)`, transition: "width .3s" }} />
        </div>
        <div style={{ fontSize: 9, opacity: 0.8, marginTop: 2, textShadow: "0 1px 4px #000" }}>{hp}/{e.maxHp}{bl > 0 ? <span style={{ color: "#67e8f9" }}> 🛡{bl}</span> : null} {statuses.length ? <span style={{ color: "#c084fc" }}> {statuses.join(" ")}</span> : null}</div>
        {e.stun > 0 ? (
          <div style={{ marginTop: 4, display: "inline-block", padding: "3px 8px", borderRadius: 8, background: "rgba(0,0,0,0.7)", border: "1px solid #c084fc66", fontSize: 9, color: "#c084fc" }}>💫 STUNNED</div>
        ) : (
          <div style={{ marginTop: 4, display: "inline-block", padding: "3px 8px", borderRadius: 8, background: "rgba(0,0,0,0.7)", border: `1px solid ${e.intent.kind === "guard" || e.intent.kind === "buff" ? "#67e8f966" : e.intent.kind === "special" || e.intent.kind === "heavy" ? "#f8717166" : "rgba(255,255,255,0.2)"}`, fontSize: 10, fontWeight: 800, color: e.intent.kind === "guard" || e.intent.kind === "buff" ? "#67e8f9" : e.intent.kind === "special" || e.intent.kind === "heavy" ? "#f87171" : "#fff" }}>
            {e.intent.label} <span style={{ opacity: 0.8, fontWeight: 400 }}>{e.intent.hint}</span>
          </div>
        )}
      </div>
    );
  }, [enemyById, dispHp, dispBlock, targetId, biome.particleColor]);

  const renderEnemyFloats = useCallback((id: number) => (
    <div style={{ position: "relative", width: 160, height: 60, fontFamily: FONT }}>
      {floats.filter((f) => f.who === id).map((f) => (
        <div key={f.id} style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", fontWeight: 900, fontSize: f.big ? 30 : 20, color: f.color, whiteSpace: "nowrap", textShadow: `0 0 16px ${f.color}aa, 0 2px 4px #000`, animation: "hdFloat 1s cubic-bezier(0.2,0.9,0.3,1) both" }}>{f.text}</div>
      ))}
    </div>
  ), [floats]);

  const hpPct = Math.max(0, Math.min(1, (dispHp.player ?? p.hp) / p.maxHp));
  useEffect(() => { if (hpPct > 0 && hpPct < 0.25 && !lowHpFired.current) { lowHpFired.current = true; audio.sfx.lowHp(); } if (hpPct >= 0.25) lowHpFired.current = false; }, [hpPct, audio]);
  useEffect(() => { if (run.phase === "victory") { audio.music(null); audio.sfx.win(); } if (run.phase === "cashout") { audio.music(null); audio.sfx.floorClear(); } }, [run.phase, audio]);
  const pBlock = dispBlock.player ?? p.block;
  const incoming = alive.filter((e) => e.stun <= 0 && (e.intent.kind === "attack" || e.intent.kind === "heavy" || e.intent.kind === "multi" || e.intent.kind === "special")).reduce((sum, e) => sum + Math.round(Math.max(0, e.intent.dmg + e.strength) * (e.weak > 0 ? 0.75 : 1)) * Math.max(1, e.intent.hits), 0);
  const through = Math.max(0, incoming - pBlock);
  const canEnd = run.phase === "battle" && !busy;
  const powers = Object.entries(p.powers).filter(([, n]) => n > 0);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", color: "#fff", overflow: "hidden", fontFamily: FONT }}>
      <DescentStage biome={biome} player={playerActor} enemies={enemyActors} targetId={targetId} onPickTarget={onPickTarget} shake={shake} speedRef={speedRef} fx={fx} renderEnemyLabel={renderEnemyLabel} renderEnemyFloats={renderEnemyFloats} />
      {flash && <div style={{ position: "absolute", inset: 0, background: flash, pointerEvents: "none", animation: "hdFlash .35s ease-out both" }} />}

      {/* top bar */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", pointerEvents: "none" }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.3em", color: biome.particleColor, fontWeight: 800 }}>FLOOR {run.floor} / {DESCENT_TOTAL_FLOORS} · {biome.name.toUpperCase()}</div>
          <div style={{ fontSize: 12, fontWeight: 900, marginTop: 2 }}>{run.faction.name.toUpperCase()} <span style={{ opacity: 0.5, fontWeight: 400, fontSize: 10 }}>· turn {run.turnNo}</span></div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            {run.relics.map((r) => (<span key={r.id} title={r.flavor} style={{ fontSize: 9, padding: "2px 7px", borderRadius: 999, border: `1px solid ${getRarityColor(r.rarity)}66`, color: getRarityColor(r.rarity), background: "rgba(0,0,0,0.55)" }}>{r.name}</span>))}
            {powers.map(([k, n]) => (<span key={k} title={POWERS[k]?.text} style={{ fontSize: 9, padding: "2px 7px", borderRadius: 999, border: "1px solid #c084fc66", color: "#c084fc", background: "rgba(0,0,0,0.55)" }}>{POWERS[k]?.name || k}{n > 1 ? ` ×${n}` : ""}</span>))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", pointerEvents: "auto" }}>
          <div style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 999, padding: "6px 12px", fontSize: 11, fontWeight: 800, color: "#fbbf24" }}>💎 +{run.unbanked}</div>
          <button type="button" onClick={() => setShowHelp(true)} title="How to play" style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, width: 30, height: 30, color: "#fff", fontSize: 13, fontWeight: 900, cursor: "pointer", fontFamily: FONT }}>?</button>
          <button type="button" onClick={audio.toggleMute} title={audio.muted ? "Unmute" : "Mute"} style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, width: 30, height: 30, color: "#fff", fontSize: 13, cursor: "pointer" }}>{audio.muted ? "🔇" : "🔊"}</button>
          <button type="button" onClick={onAbandon} style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(248,113,113,0.4)", borderRadius: 999, padding: "6px 10px", color: "#f87171", fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", cursor: "pointer", fontFamily: FONT }}>✕ ABANDON</button>
        </div>
      </div>

      {/* floor banner */}
      {banner && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", animation: "hdBanner 1.9s ease-out both" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.5em", color: biome.particleColor, marginBottom: 8 }}>◆ DESCENDING ◆</div>
            <div style={{ fontSize: "clamp(26px, 6vw, 56px)", fontWeight: 900, letterSpacing: "0.12em", textShadow: `0 0 40px ${biome.particleColor}` }}>{banner}</div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8, fontStyle: "italic" }}>{biome.subtitle}</div>
          </div>
        </div>
      )}

      {/* player floats */}
      <div style={{ position: "absolute", left: isMobile ? "60%" : "66%", bottom: isMobile ? 250 : 300, width: 200, height: 80, pointerEvents: "none" }}>
        {floats.filter((f) => f.who === "player").map((f) => (
          <div key={f.id} style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", fontWeight: 900, fontSize: f.big ? 32 : 22, color: f.color, whiteSpace: "nowrap", textShadow: `0 0 16px ${f.color}aa, 0 2px 4px #000`, animation: "hdFloat 1s cubic-bezier(0.2,0.9,0.3,1) both" }}>{f.text}</div>
        ))}
      </div>

      {/* log */}
      <div style={{ position: "absolute", right: 14, bottom: isMobile ? 236 : 250, width: isMobile ? 160 : 260, pointerEvents: "none", textAlign: "right" }}>
        {log.map((l, i) => (<div key={l.id} style={{ fontSize: isMobile ? 9 : 11, opacity: 0.35 + (i / Math.max(1, log.length - 1)) * 0.65, color: l.tone === "good" ? "#4ade80" : l.tone === "bad" ? "#f87171" : l.tone === "boom" ? "#fbbf24" : "#e5e7eb", textShadow: "0 1px 4px #000", marginTop: 2 }}>{l.text}</div>))}
      </div>

      {/* bottom HUD: HP/energy + hand + end turn */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: isMobile ? "8px 8px 10px" : "10px 16px 14px", background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.85) 30%)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, letterSpacing: "0.15em", marginBottom: 3 }}>
              <span style={{ color: hpPct < 0.25 ? "#f87171" : "#4ade80" }}>HP · {dispHp.player ?? p.hp} / {p.maxHp}{pBlock > 0 ? <span style={{ color: "#67e8f9" }}>  🛡 {pBlock}</span> : null}</span>
              <span style={{ opacity: 0.85 }}>{p.strength > 0 ? `STR +${p.strength} · ` : ""}{p.tempStrength > 0 ? `+${p.tempStrength} this turn · ` : ""}{run.phase === "battle" && incoming > 0 ? <span style={{ color: through > 0 ? "#f87171" : "#4ade80" }} title="What the enemies will deal next turn, after your Block">⚔ INCOMING {incoming}{pBlock > 0 ? ` − 🛡 ${pBlock}` : ""} = {through} TO YOU</span> : <span style={{ opacity: 0.6 }}>DMG ×{p.dmgMult.toFixed(2)}</span>}</span>
            </div>
            <div style={{ height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${hpPct * 100}%`, background: hpPct < 0.25 ? "linear-gradient(90deg,#f87171,#fca5a5)" : "linear-gradient(90deg,#16a34a,#4ade80)", transition: "width .3s" }} />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: isMobile ? 6 : 12 }}>
          {/* energy + piles */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: isMobile ? 54 : 70 }}>
            <div style={{ width: isMobile ? 48 : 60, height: isMobile ? 48 : 60, borderRadius: "50%", border: "2px solid #fbbf24", background: "radial-gradient(circle at 40% 35%, #fde68a, #b45309)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: isMobile ? 18 : 22, fontWeight: 900, color: "#1a1206", boxShadow: "0 0 24px #fbbf2466" }}>{p.energy}<span style={{ fontSize: 10, opacity: 0.7 }}>/{p.maxEnergy + (p.powers.momentum || 0)}</span></div>
            <button type="button" onClick={() => setShowPile(showPile === "draw" ? null : "draw")} style={{ fontFamily: FONT, background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "3px 8px", color: "#fff", fontSize: 9, cursor: "pointer" }}>DRAW {run.draw.length}</button>
          </div>

          {/* hand */}
          <div style={{ flex: 1, display: "flex", gap: isMobile ? 4 : 8, justifyContent: run.hand.length > 6 ? "flex-start" : "center", alignItems: "flex-end", overflowX: run.hand.length > 6 ? "auto" : "visible", overflowY: "visible", padding: "16px 8px 4px" }}>
            {run.hand.map((c, i) => {
              const cost = c.effect.xCost ? p.energy : cardCost(run, c);
              const ok = canPlay(run, i) && !busy && run.phase === "battle";
              const sel = selected === i; const col = TYPE_COLOR[c.type]; const rc = rarityColor(c.rarity);
              return (
                <button key={`${c.id}-${i}`} type="button" onClick={() => onCardClick(i)} title={c.text}
                  style={{ fontFamily: FONT, flex: "0 0 auto", width: isMobile ? 84 : 118, height: isMobile ? 118 : 156, borderRadius: 12, textAlign: "left", padding: isMobile ? 6 : 9, position: "relative",
                    border: `1px solid ${sel ? "#ffd166" : ok ? col + "99" : "rgba(255,255,255,0.12)"}`, background: ok ? `linear-gradient(180deg, ${col}22, rgba(8,8,14,0.92))` : "rgba(10,10,14,0.85)",
                    color: ok ? "#fff" : "rgba(255,255,255,0.35)", cursor: ok ? "pointer" : "not-allowed", boxShadow: sel ? "0 0 26px #ffd16688" : ok ? `0 0 14px ${col}33` : "none",
                    transform: sel ? "translateY(-14px) scale(1.04)" : "none", transition: "all .15s", animation: `hdCard .35s ${i * 0.05}s ease-out both` }}>
                  <div style={{ position: "absolute", top: -8, left: -8, width: 24, height: 24, borderRadius: "50%", background: ok ? "#fbbf24" : "#555", color: "#1a1206", fontWeight: 900, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #000" }}>{c.effect.xCost ? "X" : cost}</div>
                  <div style={{ fontSize: isMobile ? 10 : 12, fontWeight: 900, lineHeight: 1.1, color: ok ? rc : undefined }}>{c.name}</div>
                  <div style={{ fontSize: 8, letterSpacing: "0.15em", color: col, marginTop: 3 }}>{c.type.toUpperCase()}{c.target === "all" ? " · ALL" : ""}</div>
                  <div style={{ fontSize: isMobile ? 9 : 10, marginTop: 6, lineHeight: 1.3, opacity: 0.9 }}>{c.text}</div>
                  {!isMobile && <div style={{ position: "absolute", bottom: 6, right: 8, fontSize: 9, opacity: 0.35 }}>{i + 1}</div>}
                </button>
              );
            })}
            {run.hand.length === 0 && run.phase === "battle" && <div style={{ fontSize: 11, opacity: 0.5, padding: 20 }}>No cards in hand</div>}
          </div>

          {/* end turn */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: isMobile ? 64 : 90 }}>
            <button type="button" onClick={doEndTurn} disabled={!canEnd} style={{ fontFamily: FONT, width: isMobile ? 62 : 88, height: isMobile ? 62 : 88, borderRadius: "50%", border: `2px solid ${canEnd ? "#f87171" : "rgba(255,255,255,0.15)"}`, background: canEnd ? "radial-gradient(circle at 40% 35%, #fca5a5, #7f1d1d)" : "rgba(0,0,0,0.5)", color: canEnd ? "#fff" : "rgba(255,255,255,0.3)", fontSize: isMobile ? 9 : 11, fontWeight: 900, letterSpacing: "0.12em", cursor: canEnd ? "pointer" : "not-allowed", boxShadow: canEnd ? "0 0 24px #f8717166" : "none" }}>{busy ? "…" : "END\nTURN"}</button>
            <button type="button" onClick={() => setShowPile(showPile === "discard" ? null : "discard")} style={{ fontFamily: FONT, background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "3px 8px", color: "#fff", fontSize: 9, cursor: "pointer" }}>DISCARD {run.discard.length}</button>
          </div>
        </div>
        {selected != null && <div style={{ textAlign: "center", fontSize: 10, color: "#ffd166", letterSpacing: "0.2em", marginTop: 6 }}>CHOOSE A TARGET · tap an enemy</div>}
        {!isMobile && selected == null && <div style={{ textAlign: "center", fontSize: 9, opacity: 0.35, letterSpacing: "0.2em", marginTop: 6 }}>KEYS 1–{Math.max(1, run.hand.length)} PLAY · SPEND YOUR ENERGY AND THE HIVE ANSWERS · E TO PASS EARLY</div>}
      </div>

      {showPile && (
        <div onClick={() => setShowPile(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 40 }}>
          <div style={{ maxWidth: 720, width: "100%" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.4em", color: "#fbbf24", textAlign: "center", marginBottom: 12 }}>{showPile.toUpperCase()} PILE · {(showPile === "draw" ? run.draw : showPile === "discard" ? run.discard : run.exhaust).length}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              {(showPile === "draw" ? [...run.draw].sort((a, b) => a.name.localeCompare(b.name)) : showPile === "discard" ? run.discard : run.exhaust).map((c, i) => (
                <div key={i} style={{ width: 120, padding: 8, borderRadius: 10, border: `1px solid ${TYPE_COLOR[c.type]}66`, background: "rgba(8,8,14,0.9)" }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: rarityColor(c.rarity) }}>{c.name} <span style={{ color: "#fbbf24" }}>{c.effect.xCost ? "X" : c.cost}</span></div>
                  <div style={{ fontSize: 9, opacity: 0.85, marginTop: 4 }}>{c.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showHelp && <HelpOverlay onClose={closeHelp} factionCard={run.deck.find((c) => c.rarity === "faction")} />}
      {run.phase === "reward" && !busy && <RewardOverlay run={run} onChoose={(o) => onRun(chooseReward(run, o))} />}

      <style>{`
        @keyframes hdFlash{from{opacity:.9}to{opacity:0}}
        @keyframes hdFloat{0%{opacity:0;transform:translate(-50%,10px) scale(.6)}18%{opacity:1;transform:translate(-50%,-4px) scale(1.15)}70%{opacity:1;transform:translate(-50%,-26px) scale(1)}100%{opacity:0;transform:translate(-50%,-46px) scale(.95)}}
        @keyframes hdBanner{0%{opacity:0;transform:scale(1.1)}15%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0}}
        @keyframes hdCard{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}
      `}</style>
    </div>
  );
}

const GLOSSARY: [string, string][] = [
  ["Energy ⚡", "3 a turn. The gold number on a card is what it costs. Unspent energy is lost."],
  ["Block 🛡", "Soaks that much damage this turn only. It's gone when your next turn starts."],
  ["Intent", "The badge over an enemy — exactly what it does next. Attack = damage, Guard = it blocks, Enrage = it gets stronger."],
  ["Strength", "+1 damage on every hit you make for the rest of this fight."],
  ["Vulnerable", "Takes +50% damage for that many turns."],
  ["Weak", "Deals −25% damage for that many turns."],
  ["Poison ☠", "Loses that much HP each turn, then the number drops by 1."],
  ["Burn 🔥", "Loses 3 HP a turn for that many turns."],
  ["Stun 💫", "Skips its next turn entirely."],
  ["Exhaust", "That card is removed for the rest of this fight after you play it."],
  ["Power", "A purple card. Played once, it works every turn for the whole fight."],
  ["Draw / Discard", "You draw 5 from the draw pile; played cards go to discard; when the draw pile is empty the discard is shuffled back."],
];

function HelpOverlay({ onClose, factionCard }: { onClose: () => void; factionCard?: Card }) {
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
  const steps = [
    { n: "1", c: "#f87171", t: "PLAY YOUR HAND", d: `You get 3 ⚡ and 5 cards every turn. Click a card (or press its number) to play it. Strike = 6 damage, Guard = 5 Block${factionCard ? `, ${factionCard.name} = "${factionCard.text}"` : ""}.` },
    { n: "2", c: "#67e8f9", t: "READ THE INTENT, THEN DECIDE", d: "Every enemy shows its next move. The HUD adds it up: INCOMING 10 − 🛡 5 = 5 TO YOU. If that number is big, Guard. If it's 0, spend everything on damage." },
    { n: "3", c: "#4ade80", t: "ONE LIFE BAR", d: "Your HP carries across all 10 floors and does not refill. Kill fast, block the heavy turns, take Mend when you're hurt." },
    { n: "4", c: "#fbbf24", t: "WHEN YOUR ENERGY IS SPENT", d: "The hive takes its turn on its own. Then you draw a fresh hand. Kill everything on the floor and you pick a boon before the next one." },
  ];
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.82)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 60, overflowY: "auto", fontFamily: FONT }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900, width: "100%" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.5em", color: "#ff66cc" }}>◆ HOW TO FIGHT ◆</div>
          <div style={{ fontSize: "clamp(20px, 3.5vw, 30px)", fontWeight: 900, letterSpacing: "0.15em", marginTop: 6 }}>CARDS, ENERGY, ONE LIFE BAR</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 18 }}>
          {steps.map((x) => (
            <div key={x.n} style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${x.c}44`, borderLeft: `3px solid ${x.c}`, borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, letterSpacing: "0.25em", fontWeight: 800, color: x.c }}>{x.n} · {x.t}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 6, opacity: 0.9 }}>{x.d}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 9, letterSpacing: "0.3em", color: "rgba(255,255,255,0.5)", marginTop: 18, textAlign: "center" }}>WORDS ON THE CARDS</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: "6px 14px", marginTop: 8 }}>
          {GLOSSARY.map(([k, v]) => (<div key={k} style={{ fontSize: 11, lineHeight: 1.45 }}><span style={{ color: "#fbbf24", fontWeight: 800 }}>{k}</span> <span style={{ opacity: 0.8 }}>— {v}</span></div>))}
        </div>
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button type="button" onClick={onClose} style={{ fontFamily: FONT, padding: "14px 36px", borderRadius: 14, border: "none", background: "linear-gradient(180deg,#ff3399,#a3126b)", color: "#fff", fontWeight: 900, letterSpacing: "0.2em", fontSize: 13, cursor: "pointer", boxShadow: "0 0 30px #ff339966" }}>⚔ INTO THE HIVE</button>
          <div style={{ fontSize: 9, opacity: 0.4, marginTop: 8, letterSpacing: "0.2em" }}>THE ? BUTTON BRINGS THIS BACK</div>
        </div>
      </div>
    </div>
  );
}

function RewardOverlay({ run, onChoose }: { run: Run; onChoose: (o: RewardOffer) => void }) {
  const [sel, setSel] = useState<number | null>(null);
  const offers = run.rewardOffers.filter((o) => o.kind !== "cashout");
  const cash = run.rewardOffers.find((o) => o.kind === "cashout");
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.78)", backdropFilter: "blur(6px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50, overflowY: "auto" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.5em", color: "#fbbf24" }}>FLOOR {run.floor} CLEARED · +{run.unbanked} REBEL UNBANKED</div>
      <div style={{ fontSize: "clamp(22px, 4vw, 34px)", fontWeight: 900, letterSpacing: "0.15em", marginTop: 6 }}>CHOOSE YOUR BOON</div>
      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>HP {run.player.hp}/{run.player.maxHp} · Deck {run.deck.length} cards · Next: Floor {run.floor + 1}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", width: "100%", maxWidth: 980, marginTop: 22 }}>
        {offers.map((o, i) => {
          const isSel = sel === i;
          const c = o.kind === "card" ? rarityColor(o.card.rarity) : o.kind === "relic" ? getRarityColor(o.relic.rarity) : o.kind === "heal" ? "#4ade80" : "#fbbf24";
          const tag = o.kind === "card" ? `${o.card.rarity.toUpperCase()} CARD · ${o.card.type.toUpperCase()} · ${o.card.effect.xCost ? "X" : o.card.cost} ⚡` : o.kind === "relic" ? `${o.relic.rarity.toUpperCase()} RELIC` : o.kind === "heal" ? "HEAL" : "BANK IT";
          return (
            <button key={i} type="button" onClick={() => setSel(i)} style={{ animation: `hdCard .4s ${i * 0.06}s ease-out both`, width: isMobile ? "46%" : 200, textAlign: "left", fontFamily: FONT, padding: 14, borderRadius: 16, border: `1px solid ${isSel ? c : c + "55"}`, background: isSel ? `linear-gradient(180deg, ${c}33, rgba(0,0,0,0.6))` : "rgba(0,0,0,0.5)", color: "#fff", cursor: "pointer", boxShadow: isSel ? `0 0 30px ${c}66` : "none", transform: isSel ? "translateY(-4px)" : "none", transition: "all .15s" }}>
              <div style={{ fontSize: 8, letterSpacing: "0.2em", color: c }}>{tag}</div>
              <div style={{ fontSize: 15, fontWeight: 900, marginTop: 4 }}>{o.title}</div>
              <div style={{ fontSize: 11, opacity: 0.85, marginTop: 6, lineHeight: 1.35 }}>{o.desc}</div>
              {o.kind === "relic" && <div style={{ fontSize: 9, marginTop: 6, color: c }}>{describeRelic(o.relic.effect)}</div>}
              {o.kind === "heal" && <div style={{ fontSize: 9, marginTop: 6, opacity: 0.6 }}>+{HEAL_REWARD} HP now</div>}
            </button>
          );
        })}
      </div>
      <button type="button" disabled={sel == null} onClick={() => sel != null && onChoose(offers[sel])} style={{ fontFamily: FONT, marginTop: 22, padding: "14px 34px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.2)", background: sel == null ? "rgba(255,255,255,0.08)" : "linear-gradient(180deg,#ff3399,#a3126b)", color: sel == null ? "rgba(255,255,255,0.35)" : "#fff", fontWeight: 900, letterSpacing: "0.2em", fontSize: 13, cursor: sel == null ? "not-allowed" : "pointer", boxShadow: sel == null ? "none" : "0 0 30px #ff339966" }}>
        ⚔ DESCEND TO FLOOR {run.floor + 1}
      </button>
      <div style={{ fontSize: 10, opacity: 0.55, marginTop: 10, letterSpacing: "0.15em" }}>{DESCENT_TOTAL_FLOORS} FLOORS · BOSSES ON 4 · 8 · 10 · DIE AND YOU KEEP HALF</div>
      {cash && (
        <button type="button" onClick={() => onChoose(cash)} style={{ fontFamily: FONT, marginTop: 14, padding: "10px 22px", borderRadius: 12, border: "1px solid rgba(251,191,36,0.45)", background: "rgba(0,0,0,0.5)", color: "#fbbf24", fontWeight: 800, letterSpacing: "0.15em", fontSize: 11, cursor: "pointer" }}>
          ⚑ OR ESCAPE NOW · BANK {run.unbanked} REBEL AND END THE RUN
        </button>
      )}
    </div>
  );
}

function describeRelic(e: import("./relics").RelicEffect): string {
  const bits: string[] = [];
  if (e.damageMult) bits.push(`${e.damageMult > 1 ? "+" : ""}${Math.round((e.damageMult - 1) * 100)}% dmg`);
  if (e.maxHpAdd) bits.push(`${e.maxHpAdd > 0 ? "+" : ""}${e.maxHpAdd} max HP`);
  if (e.critChanceAdd) bits.push(`+${Math.round(e.critChanceAdd * 100)}% crit`);
  if (e.critDamageAdd) bits.push(`+${Math.round(e.critDamageAdd * 30)}% dmg`);
  if (e.healOnKill) bits.push(`heal ${e.healOnKill} per kill`);
  if (e.ignite) bits.push("attacks burn");
  if (e.reviveOnce) bits.push("revive once at 40%");
  if (e.dodgeIframesAdd) bits.push(`+${Math.round(e.dodgeIframesAdd / 20)}% dodge`);
  if (e.speedMult) bits.push(`+${Math.round((e.speedMult - 1) * 50)}% dodge`);
  if (e.attackSpeedMult) bits.push(`${Math.round((e.attackSpeedMult - 1) * 100)}% follow-up hit`);
  if (e.specialCooldownMult) bits.push("faction card costs 1 less");
  if (e.rebelGainMult) bits.push(`+${Math.round((e.rebelGainMult - 1) * 100)}% REBEL`);
  return bits.join(" · ");
}
