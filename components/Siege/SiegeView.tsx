// components/Siege/SiegeView.tsx — The Siege shell: title + defender selection, souls-style HUD, banners, boss bar. The 3D engine loads on the client only.
import React, { useEffect, useRef, useState } from "react";
import { type Hud, FACTIONS, KIT, WAVES, viewOf } from "./shared";

const EMPTY: Hud = { gate: 1000, gateMax: 1000, wave: 0, waves: WAVES.length, horde: 0, score: 0, kills: 0, reload: 0, state: "ready", msg: null, intro: false, menu: true };
/** power · range · area · speed (0–10). Ronin leads every column by design. */
const STATS: Record<string, [number, number, number, number]> = {
  ronin: [10, 9, 9, 9], samurai: [8, 7, 7, 6], warrior: [9, 6, 9, 3], buke: [6, 7, 6, 6], shogun: [6, 8, 8, 4],
  ashigaru: [6, 8, 5, 8], yamabushi: [8, 7, 8, 6], kenshi: [7, 8, 5, 9], sohei: [5, 7, 7, 5], bushi: [7, 6, 4, 8], wokou: [7, 8, 6, 6],
};
const GOLD = "#e8c170", CREAM = "#efe4cf", MUTED = "#a89a82";
const cinzel = "'Cinzel', Georgia, serif";

function Crest({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter: "drop-shadow(0 0 18px rgba(255,150,60,0.75))" }}>
      <defs><radialGradient id="cg" cx="50%" cy="45%" r="55%"><stop offset="0%" stopColor="#ffcf7a" /><stop offset="60%" stopColor="#e07a2a" /><stop offset="100%" stopColor="#6a2410" /></radialGradient></defs>
      <circle cx="50" cy="50" r="46" fill="url(#cg)" opacity="0.95" /><circle cx="50" cy="50" r="40" fill="none" stroke="#2a1206" strokeWidth="3" />
      <g fill="#2a1206" stroke="#2a1206" strokeWidth="3" strokeLinecap="round">
        <ellipse cx="50" cy="34" rx="8" ry="7" /><ellipse cx="50" cy="48" rx="6" ry="7" /><ellipse cx="50" cy="66" rx="9" ry="12" />
        <path d="M46 28 Q38 16 32 18 M54 28 Q62 16 68 18" fill="none" />
        <path d="M45 46 L30 38 L26 48 M55 46 L70 38 L74 48 M45 50 L28 52 L24 62 M55 50 L72 52 L76 62 M46 54 L32 64 L32 74 M54 54 L68 64 L68 74" fill="none" />
      </g>
    </svg>
  );
}
function Bar({ v, color = GOLD }: { v: number; color?: string }) {
  return <div style={{ display: "flex", gap: 3 }}>{Array.from({ length: 10 }, (_, i) => <div key={i} style={{ width: 10, height: 6, background: i < v ? color : "rgba(255,255,255,0.1)", boxShadow: i < v ? `0 0 6px ${color}66` : "none", transform: "skewX(-20deg)" }} />)}</div>;
}

export default function SiegeView() {
  const wrapRef = useRef<HTMLDivElement | null>(null); const canvasRef = useRef<HTMLCanvasElement | null>(null); const engRef = useRef<any>(null); const autoStart = useRef(false);
  const [hud, setHud] = useState<Hud>(EMPTY); const [result, setResult] = useState<{ won: boolean; score: number; kills: number; waves: number } | null>(null); const [err, setErr] = useState<string | null>(null); const [gen, setGen] = useState(0);
  const [fs, setFs] = useState(false); const [run, setRun] = useState(false); const [picker, setPicker] = useState(false); const [loading, setLoading] = useState(true);
  const [faction, setFaction] = useState<string>(() => { try { const f = localStorage.getItem("ra:siege:faction"); return f && (FACTIONS as readonly string[]).includes(f) ? f : "ronin"; } catch { return "ronin"; } });
  const factionRef = useRef(faction); factionRef.current = faction; const mode = viewOf(faction);
  const [boxH, setBoxH] = useState(600); const compact = boxH < 460;
  useEffect(() => { const el = wrapRef.current; if (!el || typeof ResizeObserver === "undefined") return; const ro = new ResizeObserver(() => setBoxH(el.clientHeight)); ro.observe(el); setBoxH(el.clientHeight); return () => ro.disconnect(); }, []);

  useEffect(() => {
    let alive = true; let eng: any = null; setHud(EMPTY); setErr(null); setLoading(true);
    (async () => {
      try {
        const cb = { onHud: (h: Hud) => { if (alive) setHud(h); }, onEnd: (r: any) => { if (alive) setResult(r); } };
        const mod = await import("./world3d"); if (!alive || !canvasRef.current) return; eng = new mod.SiegeWorld(canvasRef.current, cb);
        eng.faction = factionRef.current; engRef.current = eng; await eng.init(); if (!alive) return; setLoading(false);
        if (autoStart.current) { autoStart.current = false; eng.startIntro(); }
      } catch (e: any) { console.error(e); if (alive) setErr(e?.message || String(e)); }
    })();
    return () => { alive = false; try { eng?.destroy(); } catch {} engRef.current = null; };
  }, [gen]);

  const goFs = async () => { const el = wrapRef.current; if (!el || document.fullscreenElement) return; try { await el.requestFullscreen?.(); setFs(true); } catch {} try { await (screen.orientation as any)?.lock?.("landscape"); } catch {} };
  const toggleFs = async () => { try { if (!document.fullscreenElement) await goFs(); else { await document.exitFullscreen?.(); setFs(false); } } catch {} };
  useEffect(() => { const h = () => setFs(!!document.fullscreenElement); document.addEventListener("fullscreenchange", h); return () => document.removeEventListener("fullscreenchange", h); }, []);

  const choose = (f: string) => { if (f === faction) return; try { localStorage.setItem("ra:siege:faction", f); } catch {} setFaction(f); engRef.current?.setFaction?.(f); };
  const manTheWall = () => { goFs(); if (picker) { setPicker(false); engRef.current?.setPaused?.(false); return; } engRef.current?.startIntro?.(); };
  const openPicker = () => { setPicker(true); engRef.current?.setPaused?.(true); };

  const inMenu = !!hud.menu || picker; const playing = !hud.menu && !hud.intro && !picker;
  const gatePct = Math.max(0, Math.min(100, (hud.gate / hud.gateMax) * 100));
  const st = STATS[faction] || STATS.ronin;

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", aspectRatio: fs ? undefined : "16 / 9", maxHeight: fs ? undefined : "calc(100vh - 70px)", height: fs ? "100%" : undefined, background: "#140f0a", borderRadius: fs ? 0 : 14, overflow: "hidden", border: fs ? "none" : "1px solid rgba(232,193,112,0.2)", boxShadow: fs ? "none" : "0 24px 70px rgba(0,0,0,0.6)", touchAction: "none", userSelect: "none", WebkitUserSelect: "none", fontFamily: cinzel }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", touchAction: "none", cursor: mode === "pov" ? "crosshair" : "default" }} />
      {/* cinematic vignette */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at 50% 55%, transparent 55%, rgba(20,10,4,0.45) 100%)" }} />

      {/* ── HUD (souls-style) */}
      {playing && (
        <>
          <div style={{ position: "absolute", top: 14, left: 18, pointerEvents: "none" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.3em", color: CREAM, textShadow: "0 1px 3px #000" }}>THE GATE</div>
            <div style={{ width: "min(300px, 34vw)", height: 7, marginTop: 5, background: "rgba(0,0,0,0.55)", border: "1px solid rgba(232,193,112,0.45)", position: "relative" }}>
              <div style={{ position: "absolute", inset: 0, width: `${gatePct}%`, background: "linear-gradient(180deg,#e0533a,#8e1b1b)", boxShadow: "0 0 8px rgba(224,83,58,0.6)", transition: "width .25s" }} />
            </div>
            <div style={{ fontSize: 11, letterSpacing: "0.2em", color: MUTED, marginTop: 6, textShadow: "0 1px 3px #000" }}>WAVE <span style={{ color: GOLD }}>{hud.wave}</span> / {hud.waves} · HORDE <span style={{ color: "#d9a3ff" }}>{hud.horde}</span></div>
          </div>
          <div style={{ position: "absolute", top: 12, right: 16, display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ fontSize: 20, letterSpacing: "0.1em", color: GOLD, textShadow: "0 0 14px rgba(232,193,112,0.5), 0 2px 3px #000", pointerEvents: "none" }}>{hud.score.toLocaleString()}</div>
            <button type="button" onClick={openPicker} style={btn}>⚔ DEFENDER</button>
            <button type="button" onClick={toggleFs} style={btn}>{fs ? "✕" : "⛶"}</button>
          </div>
          {/* defender medallion */}
          <div style={{ position: "absolute", left: 16, bottom: 14, display: "flex", alignItems: "center", gap: 10, pointerEvents: "none" }}>
            <div style={{ width: 58, height: 58, borderRadius: "50%", border: `2px solid ${GOLD}`, background: "radial-gradient(circle at 50% 35%, #4a3020, #140c06)", overflow: "hidden", boxShadow: "0 0 16px rgba(232,193,112,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}><img src={`/descent/portraits/${faction}.png`} alt="" style={{ height: "100%", objectFit: "contain" }} /></div>
            <div style={{ maxWidth: 320, textShadow: "0 1px 3px #000" }}><div style={{ fontSize: 13, letterSpacing: "0.2em", color: GOLD }}>{KIT[faction].name.toUpperCase()}</div><div style={{ fontFamily: "system-ui, sans-serif", fontSize: 11, color: CREAM, opacity: 0.85 }}>{KIT[faction].ammo}</div></div>
          </div>
          {/* charge / reload */}
          <div style={{ position: "absolute", left: "50%", bottom: 16, transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.3em", color: hud.charge ? (hud.charge > 0.92 ? "#ffb070" : CREAM) : MUTED, textShadow: "0 1px 3px #000", marginBottom: 5 }}>{hud.charge ? (hud.charge > 0.92 ? "RELEASE" : "CHARGING") : hud.reload > 0 ? "RELOADING" : "HOLD TO CHARGE"}</div>
            <div style={{ width: "min(240px, 30vw)", height: 4, background: "rgba(0,0,0,0.55)", border: "1px solid rgba(232,193,112,0.35)" }}><div style={{ height: "100%", width: `${hud.charge ? hud.charge * 100 : (1 - hud.reload) * 100}%`, background: hud.charge ? (hud.charge > 0.92 ? "#ffb070" : GOLD) : hud.reload > 0 ? "#7a6a52" : GOLD }} /></div>
          </div>
          {/* set the trebuchet (catapult crews, once) */}
          {hud.treb && (
            <button type="button" onClick={() => engRef.current?.placeTreb?.()} style={{ position: "absolute", left: "50%", bottom: compact ? 76 : 64, transform: "translateX(-50%)", fontFamily: cinzel, fontSize: compact ? 12 : 15, letterSpacing: "0.26em", color: "#1a0f06", background: "linear-gradient(180deg,#f3d58f,#c9953f)", border: "1px solid #fff0c0", padding: compact ? "7px 16px" : "10px 24px", cursor: "pointer", boxShadow: "0 0 24px rgba(255,190,90,0.6), 0 4px 10px #000", animation: "siegePulse 1.4s ease-in-out infinite" }}>⚒ SET TREBUCHET HERE <span style={{ opacity: 0.6, fontSize: "0.75em" }}>(E)</span></button>
          )}
          {/* move pad: drag the stick anywhere (push all the way to run) */}
          <div style={{ position: "absolute", right: 14, bottom: 12, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
            {!compact && <div style={{ fontFamily: "system-ui, sans-serif", fontSize: 10, color: MUTED, textShadow: "0 1px 3px #000", pointerEvents: "none" }}><b style={{ color: CREAM }}>WASD</b> move · <b style={{ color: CREAM }}>SHIFT</b> run · <b style={{ color: CREAM }}>V</b> wall view</div>}
            <button type="button" onClick={() => engRef.current?.toggleWallView?.()} style={{ ...btn, fontSize: compact ? 11 : 13, letterSpacing: "0.18em", padding: compact ? "7px 12px" : "9px 16px", color: hud.wallView ? "#1a0f06" : (hud.threat ? "#fff" : CREAM), background: hud.wallView ? "linear-gradient(180deg,#f3d58f,#c9953f)" : hud.threat ? "linear-gradient(180deg,#c43a2a,#6e140e)" : btn.background, border: hud.threat && !hud.wallView ? "1px solid #ffb0a0" : btn.border, boxShadow: hud.threat && !hud.wallView ? "0 0 18px rgba(255,80,60,0.7)" : "none", animation: hud.threat && !hud.wallView ? "siegePulse 0.9s ease-in-out infinite" : undefined }}>{hud.wallView ? "⬆ BACK TO THE WALK (V)" : `⬇ WALL VIEW (V)${hud.threat ? ` · ${hud.threat} ON THE WALL` : ""}`}</button>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <button type="button" onClick={() => { const r = !run; setRun(r); const e = engRef.current; e?.setMove?.(e.moveIn ?? 0, e.moveInZ ?? 0, r); }} style={{ ...btn, height: compact ? 34 : 38, padding: "0 10px", color: run ? "#1a0f06" : CREAM, background: run ? "linear-gradient(180deg,#f3d58f,#c9953f)" : btn.background }}>RUN</button>
              <Stick size={compact ? 92 : 112} onMove={(x, z) => { const e = engRef.current; e?.setMove?.(x, z); }} />
            </div>
          </div>
          {/* boss bar */}
          {hud.boss && (
            <div style={{ position: "absolute", left: "50%", bottom: 62, transform: "translateX(-50%)", width: "min(620px, 64vw)", pointerEvents: "none" }}>
              <div style={{ fontSize: 13, letterSpacing: "0.22em", color: CREAM, textShadow: "0 1px 4px #000", marginBottom: 5 }}>{hud.boss.name}</div>
              <div style={{ height: 7, background: "rgba(0,0,0,0.6)", border: "1px solid rgba(232,193,112,0.4)" }}><div style={{ height: "100%", width: `${(hud.boss.hp / hud.boss.max) * 100}%`, background: "linear-gradient(180deg,#e0533a,#7a1414)", transition: "width .2s" }} /></div>
            </div>
          )}
        </>
      )}

      {/* ── banners + toasts */}
      {hud.msg && hud.banner && !inMenu && (
        <div key={hud.msg} style={{ position: "absolute", top: "34%", left: 0, right: 0, textAlign: "center", pointerEvents: "none", animation: "siegeBanner 2.8s ease-out both" }}>
          <div style={{ width: "min(520px, 70%)", height: 1, margin: "0 auto 12px", background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }} />
          <div style={{ fontSize: "clamp(22px, 3.6vw, 44px)", letterSpacing: "0.22em", color: "#f3dca8", textShadow: "0 0 30px rgba(255,170,80,0.55), 0 2px 4px #000" }}>{hud.msg.toUpperCase()}</div>
          <div style={{ width: "min(520px, 70%)", height: 1, margin: "12px auto 0", background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }} />
        </div>
      )}
      {hud.msg && !hud.banner && playing && <div key={hud.msg} style={{ position: "absolute", top: "20%", left: 0, right: 0, textAlign: "center", pointerEvents: "none", fontSize: "clamp(14px, 2vw, 22px)", letterSpacing: "0.14em", color: GOLD, textShadow: "0 0 18px rgba(232,160,80,0.6), 0 2px 3px #000", animation: "siegeMsg .35s ease-out" }}>{hud.msg}</div>}

      {/* ── intro titles over the fly-in */}
      {hud.intro && !err && (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", textAlign: "center", background: "linear-gradient(180deg, rgba(10,6,2,0.35), transparent 28%, transparent 70%, rgba(10,6,2,0.55))" }}>
          <div style={{ position: "absolute", top: "30%", left: 0, right: 0 }}>
            <div style={{ fontSize: "clamp(11px, 1.5vw, 15px)", letterSpacing: "0.5em", color: CREAM, animation: "siegeIntroA 11s ease-in-out both" }}>THE HORDE IS ON THE FIELD</div>
            <div style={{ fontSize: "clamp(36px, 7vw, 86px)", letterSpacing: "0.16em", color: "#f3dca8", textShadow: "0 0 50px rgba(255,150,60,0.6), 0 3px 0 #000", marginTop: 10, animation: "siegeIntroB 11s ease-in-out both" }}>THE SIEGE</div>
            <div style={{ fontSize: "clamp(11px, 1.5vw, 15px)", letterSpacing: "0.45em", color: CREAM, marginTop: 10, animation: "siegeIntroC 11s ease-in-out both" }}>HOLD THE GATE UNTIL THE HORN</div>
          </div>
          <div style={{ position: "absolute", bottom: 28, left: 0, right: 0, fontSize: 11, letterSpacing: "0.35em", color: MUTED }}>TAP TO SKIP</div>
        </div>
      )}

      {/* ── title + defender selection */}
      {inMenu && !err && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "linear-gradient(180deg, rgba(12,7,3,0.55) 0%, rgba(12,7,3,0.25) 30%, rgba(12,7,3,0.55) 62%, rgba(12,7,3,0.9) 100%)", padding: "clamp(10px, 2.2vh, 24px) clamp(12px, 2.4vw, 32px)", gap: "clamp(6px, 1.4vh, 14px)", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, flex: "0 0 auto" }}>
            <Crest size={compact ? 30 : 52} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: compact ? 22 : "clamp(26px, 4.6vw, 54px)", letterSpacing: "0.18em", color: "#f3dca8", textShadow: "0 0 36px rgba(255,150,60,0.55), 0 3px 0 #000", lineHeight: 1 }}>THE SIEGE</div>
              <div style={{ fontSize: compact ? 8 : "clamp(9px, 1.1vw, 12px)", letterSpacing: "0.45em", color: CREAM, opacity: 0.85, marginTop: compact ? 3 : 6 }}>{picker ? "CHANGE YOUR DEFENDER" : "CHOOSE YOUR DEFENDER"}</div>
            </div>
            <Crest size={compact ? 30 : 52} />
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex", gap: "clamp(10px, 2vw, 26px)", alignItems: "stretch" }}>
            {/* selected defender */}
            <div style={{ flex: "0 0 clamp(210px, 30%, 360px)", display: "flex", flexDirection: "column", background: "linear-gradient(180deg, rgba(40,24,12,0.72), rgba(14,8,4,0.85))", border: `1px solid rgba(232,193,112,0.35)`, boxShadow: "inset 0 0 40px rgba(0,0,0,0.6)", padding: "clamp(8px, 1.4vw, 16px)", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 38%, rgba(255,160,70,0.28), transparent 60%)", pointerEvents: "none" }} />
              {!compact && <div style={{ flex: 1, minHeight: 90, display: "flex", alignItems: "flex-end", justifyContent: "center", position: "relative" }}><img key={faction} src={`/descent/portraits/${faction}.png`} alt={faction} style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain", filter: "drop-shadow(0 10px 18px rgba(0,0,0,0.7))", animation: "siegeRise .35s ease-out" }} /></div>}
              <div style={{ position: "relative", marginTop: 8 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><div style={{ fontSize: "clamp(18px, 2.2vw, 26px)", letterSpacing: "0.14em", color: GOLD }}>{KIT[faction].name.toUpperCase()}</div><div style={{ fontSize: 9, letterSpacing: "0.2em", color: mode === "pov" ? "#9ec7ff" : "#ffb070", border: "1px solid currentColor", padding: "2px 6px", whiteSpace: "nowrap" }}>{mode === "pov" ? "BATTLEMENTS" : "TREBUCHET"}</div></div>
                <div style={{ fontFamily: "system-ui, sans-serif", fontSize: compact ? 10 : "clamp(11px, 1.1vw, 13px)", color: CREAM, opacity: 0.88, margin: compact ? "4px 0 0" : "6px 0 8px", lineHeight: 1.3 }}>{KIT[faction].ammo}</div>
                {(["POWER", "RANGE", "AREA", "SPEED"] as const).map((n, i) => <div key={n} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 3 }}><span style={{ fontSize: 9, letterSpacing: "0.25em", color: MUTED }}>{n}</span><Bar v={st[i]} color={faction === "ronin" ? "#ff6a5a" : GOLD} /></div>)}
              </div>
            </div>
            {/* roster */}
            <div style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: compact ? "repeat(6, 1fr)" : "repeat(auto-fill, minmax(clamp(74px, 9vw, 112px), 1fr))", gridAutoRows: compact ? "1fr" : "minmax(72px, 1fr)", gap: "clamp(5px, 0.8vw, 10px)", alignContent: "stretch", overflowY: "auto" }}>
              {FACTIONS.map((f) => { const on = f === faction; const pov = viewOf(f) === "pov"; return (
                <button key={f} type="button" onClick={() => choose(f)} style={{ position: "relative", padding: 0, minHeight: compact ? 0 : 72, cursor: "pointer", background: on ? "linear-gradient(180deg, rgba(232,160,70,0.35), rgba(60,30,10,0.85))" : "linear-gradient(180deg, rgba(50,32,18,0.75), rgba(14,8,4,0.9))", border: on ? `1px solid ${GOLD}` : "1px solid rgba(232,193,112,0.18)", boxShadow: on ? "0 0 22px rgba(255,170,80,0.55), inset 0 0 20px rgba(255,170,80,0.2)" : "inset 0 0 18px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", overflow: "hidden", transition: "all .15s", transform: on ? "translateY(-2px)" : "none" }}>
                  <img src={`/descent/portraits/${f}.png`} alt={f} style={{ position: "absolute", inset: "6% 6% 22% 6%", width: "88%", height: "72%", objectFit: "contain", objectPosition: "bottom", filter: on ? "drop-shadow(0 4px 8px rgba(0,0,0,0.8))" : "brightness(0.7) saturate(0.75)" }} />
                  <div style={{ position: "absolute", top: 5, right: 6, fontSize: 11, opacity: 0.8 }} title={pov ? "Battlements view" : "Trebuchet view"}>{pov ? "🏹" : "🪨"}</div>
                  <div style={{ position: "relative", width: "100%", padding: "4px 2px", background: "linear-gradient(0deg, rgba(0,0,0,0.85), transparent)", fontSize: compact ? 7 : "clamp(8px, 0.9vw, 11px)", letterSpacing: compact ? "0.06em" : "0.14em", color: on ? GOLD : CREAM }}>{KIT[f].name.toUpperCase()}</div>
                </button>); })}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 14, flex: "0 0 auto" }}>
            <button type="button" disabled={loading && !picker} onClick={manTheWall} style={{ fontFamily: cinzel, fontSize: compact ? 12 : "clamp(13px, 1.5vw, 17px)", letterSpacing: "0.3em", padding: compact ? "6px 22px" : "clamp(8px, 1.2vh, 13px) clamp(22px, 3vw, 44px)", color: "#1e1206", cursor: loading && !picker ? "wait" : "pointer", background: "linear-gradient(180deg, #f6d68a, #d49a3e 60%, #a8682a)", border: "1px solid #ffe3a3", boxShadow: "0 0 26px rgba(255,170,80,0.55), inset 0 1px 0 rgba(255,255,255,0.6)", opacity: loading && !picker ? 0.6 : 1 }}>{loading && !picker ? "RAISING THE WALLS…" : picker ? "RETURN TO THE WALL" : "MAN THE WALL"}</button>
            {!compact && <div style={{ fontFamily: "system-ui, sans-serif", fontSize: 11, color: MUTED, maxWidth: 260, lineHeight: 1.35 }}>Move to aim · <b style={{ color: CREAM }}>hold</b> to charge · release to fire. 12 waves, every stretch of the wall, and the Brood Mother.</div>}
          </div>
        </div>
      )}

      {result && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,6,2,0.6)" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 420, maxWidth: "80vw", height: 1, margin: "0 auto 14px", background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }} />
            <div style={{ fontSize: "clamp(28px, 5vw, 52px)", letterSpacing: "0.2em", color: result.won ? "#f3dca8" : "#e0533a", textShadow: "0 0 30px rgba(255,150,60,0.5), 0 3px 0 #000" }}>{result.won ? "THE GATE HOLDS" : "THE GATE HAS FALLEN"}</div>
            <div style={{ marginTop: 10, color: CREAM, fontSize: 14, letterSpacing: "0.18em" }}>SCORE <b style={{ color: GOLD }}>{result.score}</b> · KILLS <b>{result.kills}</b> · WAVES <b>{result.waves}</b></div>
            <div style={{ width: 420, maxWidth: "80vw", height: 1, margin: "14px auto 18px", background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }} />
            <button type="button" onClick={() => { setResult(null); setHud(EMPTY); autoStart.current = true; setGen((g) => g + 1); }} style={{ ...btn, fontSize: 14, padding: "10px 26px", color: "#1e1206", background: "linear-gradient(180deg, #f6d68a, #d49a3e 60%, #a8682a)", border: "1px solid #ffe3a3" }}>MAN THE WALL AGAIN</button>
          </div>
        </div>
      )}
      {err && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#e0533a", background: "rgba(0,0,0,0.7)", padding: 20, textAlign: "center", fontSize: 13, fontFamily: "system-ui, sans-serif" }}>The siege engine could not start on this device ({err}). WebGL is required.</div>}
      <style>{`@keyframes siegeMsg { from { opacity:0; transform: translateY(-8px) scale(.96);} to { opacity:1; transform:none; } }
        @keyframes siegePulse { 0%,100% { filter: brightness(1) } 50% { filter: brightness(1.25) } }
        @keyframes siegeBanner { 0% { opacity:0; letter-spacing:.4em } 18% { opacity:1 } 80% { opacity:1 } 100% { opacity:0 } }
        @keyframes siegeRise { from { opacity:0; transform: translateY(10px) } to { opacity:1; transform:none } }
        @keyframes siegeIntroA { 0%,8% { opacity:0; transform:translateY(6px) } 18%,40% { opacity:.85; transform:none } 50%,100% { opacity:0 } }
        @keyframes siegeIntroB { 0%,30% { opacity:0; letter-spacing:.5em } 42%,88% { opacity:1; letter-spacing:.16em } 100% { opacity:0 } }
        @keyframes siegeIntroC { 0%,48% { opacity:0; transform:translateY(6px) } 58%,88% { opacity:.85; transform:none } 100% { opacity:0 } }`}</style>
    </div>
  );
}
/** virtual joystick: x right +, z toward the camera + (i.e. back), each -1…1 */
function Stick({ size, onMove }: { size: number; onMove: (x: number, z: number) => void }) {
  const [k, setK] = useState({ x: 0, y: 0 }); const ref = useRef<HTMLDivElement | null>(null); const R = size / 2 - 18;
  const upd = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2); const d = Math.hypot(x, y); if (d > R) { x *= R / d; y *= R / d; } setK({ x, y }); const m = Math.hypot(x, y) / R; onMove(m < 0.12 ? 0 : x / R, m < 0.12 ? 0 : y / R); };
  const end = () => { setK({ x: 0, y: 0 }); onMove(0, 0); };
  return (
    <div ref={ref} onPointerDown={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); upd(e); }} onPointerMove={(e) => { if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) upd(e); }} onPointerUp={end} onPointerCancel={end} onContextMenu={(e) => e.preventDefault()}
      style={{ width: size, height: size, borderRadius: "50%", position: "relative", touchAction: "none", cursor: "grab", background: "radial-gradient(circle, rgba(20,12,6,0.35), rgba(20,12,6,0.7))", border: "1px solid rgba(232,193,112,0.45)", boxShadow: "inset 0 0 18px rgba(0,0,0,0.6)", backdropFilter: "blur(3px)" }}>
      {["▲", "▼", "◀", "▶"].map((c, i) => <span key={c} style={{ position: "absolute", fontSize: 9, color: "rgba(232,193,112,0.55)", left: i === 2 ? 6 : i === 3 ? undefined : "50%", right: i === 3 ? 6 : undefined, top: i === 0 ? 4 : i === 1 ? undefined : "50%", bottom: i === 1 ? 4 : undefined, transform: i < 2 ? "translateX(-50%)" : "translateY(-50%)", pointerEvents: "none" }}>{c}</span>)}
      <div style={{ position: "absolute", width: 36, height: 36, left: "50%", top: "50%", marginLeft: -18, marginTop: -18, transform: `translate(${k.x}px, ${k.y}px)`, borderRadius: "50%", background: "radial-gradient(circle at 40% 35%, #f3d58f, #a8762e)", boxShadow: "0 2px 8px #000", pointerEvents: "none" }} />
    </div>
  );
}
const btn: React.CSSProperties = { fontFamily: cinzel, fontSize: 11, letterSpacing: "0.2em", color: CREAM, background: "rgba(20,12,6,0.7)", border: "1px solid rgba(232,193,112,0.4)", padding: "6px 10px", cursor: "pointer", backdropFilter: "blur(4px)" };
