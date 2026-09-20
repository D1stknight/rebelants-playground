// components/Siege/SiegeView.tsx — phase 1 solo drill: canvas + DOM HUD. The engine (PixiJS + planck) is loaded on the client only.
import React, { useEffect, useRef, useState } from "react";
import { type Hud, FACTIONS, KIT, viewOf } from "./shared";
const modeOf = viewOf;

const EMPTY: Hud = { gate: 1000, gateMax: 1000, wave: 0, waves: 6, horde: 0, score: 0, kills: 0, reload: 0, state: "ready", msg: null, intro: true };

export default function SiegeView() {
  const wrapRef = useRef<HTMLDivElement | null>(null); const canvasRef = useRef<HTMLCanvasElement | null>(null); const engRef = useRef<any>(null);
  const [hud, setHud] = useState<Hud>(EMPTY); const [result, setResult] = useState<{ won: boolean; score: number; kills: number; waves: number } | null>(null); const [err, setErr] = useState<string | null>(null); const [gen, setGen] = useState(0);
  const [fs, setFs] = useState(false); const [faction, setFaction] = useState<string>(() => { try { return localStorage.getItem("ra:siege:faction") || "ronin"; } catch { return "ronin"; } });

  const mode = modeOf(faction); const factionRef = useRef(faction); factionRef.current = faction;
  useEffect(() => {
    let alive = true; let eng: any = null; setHud(EMPTY); setErr(null);
    (async () => {
      try {
        const cb = { onHud: (h: Hud) => { if (alive) setHud(h); }, onEnd: (r: any) => { if (alive) setResult(r); } };
        const mod = await import("./world3d"); if (!alive || !canvasRef.current) return; eng = new mod.SiegeWorld(canvasRef.current, cb);
        eng.faction = factionRef.current; engRef.current = eng; await eng.init();
      } catch (e: any) { console.error(e); if (alive) setErr(e?.message || String(e)); }
    })();
    return () => { alive = false; try { eng?.destroy(); } catch {} engRef.current = null; };
  }, [gen]);

  const goFs = async () => { const el = wrapRef.current; if (!el || document.fullscreenElement) return; try { await el.requestFullscreen?.(); setFs(true); } catch {} try { await (screen.orientation as any)?.lock?.("landscape"); } catch {} };
  const toggleFs = async () => { try { if (!document.fullscreenElement) await goFs(); else { await document.exitFullscreen?.(); setFs(false); } } catch {} };
  // the first tap (skip intro / man the wall) also takes the screen: it is a user gesture, so fullscreen is allowed
  const onCanvasDown = () => { if (hud.state === "ready" && !fs) goFs(); };
  useEffect(() => { const h = () => setFs(!!document.fullscreenElement); document.addEventListener("fullscreenchange", h); return () => document.removeEventListener("fullscreenchange", h); }, []);

  const gatePct = Math.max(0, Math.min(100, (hud.gate / hud.gateMax) * 100)); const gateColor = gatePct > 60 ? "#5fc78a" : gatePct > 30 ? "#f0a63a" : "#e0475b";
  const pill: React.CSSProperties = { background: "rgba(8,10,20,0.72)", border: "1px solid rgba(240,166,58,0.25)", borderRadius: 8, padding: "6px 12px", fontSize: 12, letterSpacing: "0.08em", color: "#e9e2d2", fontWeight: 700, whiteSpace: "nowrap", backdropFilter: "blur(4px)" };

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", aspectRatio: fs ? undefined : "52 / 22", height: fs ? "100%" : undefined, background: "#0b0e17", borderRadius: fs ? 0 : 16, overflow: "hidden", border: fs ? "none" : "1px solid rgba(240,166,58,0.18)", boxShadow: fs ? "none" : "0 20px 60px rgba(0,0,0,0.55)", touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}>
      <canvas ref={canvasRef} onPointerDown={onCanvasDown} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", touchAction: "none", cursor: mode === "pov" ? "crosshair" : "default" }} />
      {/* HUD */}
      <div style={{ position: "absolute", top: 10, left: 12, right: 12, display: "flex", gap: 8, alignItems: "flex-start", pointerEvents: "none", fontFamily: "'Cinzel', Georgia, serif" }}>
        <div style={{ ...pill, minWidth: 190 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.8, marginBottom: 4 }}><span>GATE</span><span>{hud.gate} / {hud.gateMax}</span></div>
          <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}><div style={{ width: `${gatePct}%`, height: "100%", background: gateColor, boxShadow: `0 0 10px ${gateColor}`, transition: "width .25s" }} /></div>
        </div>
        <div style={pill}>WAVE <span style={{ color: "#ffd27a" }}>{hud.wave}</span> / {hud.waves}</div>
        <div style={pill}>HORDE <span style={{ color: "#c4b5fd" }}>{hud.horde}</span></div>
        <div style={{ flex: 1 }} />
        <div style={pill}>SCORE <span style={{ color: "#ffd27a" }}>{hud.score}</span></div>
        <div style={{ ...pill, minWidth: 110 }}>
          <div style={{ fontSize: 10, opacity: 0.8, marginBottom: 4 }}>{hud.charge ? (hud.charge > 0.92 ? "CHARGED — RELEASE!" : "CHARGING…") : hud.reload > 0 ? "RELOADING" : "AIM · HOLD TO CHARGE"}</div>
          <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}><div style={{ width: `${hud.charge ? hud.charge * 100 : (1 - hud.reload) * 100}%`, height: "100%", background: hud.charge ? (hud.charge > 0.92 ? "#ff8a4a" : "#9ec7ff") : hud.reload > 0 ? "#a29a88" : "#ffd27a" }} /></div>
        </div>
      </div>
      {/* faction picker */}
      <div style={{ position: "absolute", left: 12, right: 12, bottom: 10, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
        <div style={{ alignSelf: "flex-end", marginRight: 100, fontFamily: "'Cinzel', Georgia, serif", fontSize: 12, color: "#e9e2d2", background: "rgba(8,10,20,0.72)", border: "1px solid rgba(240,166,58,0.25)", borderRadius: 8, padding: "6px 12px", maxWidth: 460, backdropFilter: "blur(4px)" }}>
          <div style={{ color: "#ffd27a", letterSpacing: "0.15em" }}>{KIT[faction].name.toUpperCase()} <span style={{ opacity: 0.6, fontSize: 9 }}>· {mode === "pov" ? "BATTLEMENTS VIEW" : "CATAPULT VIEW"}</span></div><div style={{ fontFamily: "system-ui, sans-serif", fontSize: 12, opacity: 0.85, marginTop: 2 }}>{KIT[faction].ammo}</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", overflowX: "auto", scrollbarWidth: "none", pointerEvents: "auto", paddingRight: 100 }}>
          {[...FACTIONS, "boulder"].map((f) => { const on = f === faction; const sz = on ? 76 : 60; return (
            <button key={f} type="button" title={KIT[f].name} onClick={() => { if (f === faction) return; try { localStorage.setItem("ra:siege:faction", f); } catch {} setFaction(f); engRef.current?.setFaction?.(f); }}
              style={{ width: sz, height: sz + 16, borderRadius: 10, flex: "0 0 auto", padding: 0, overflow: "hidden", cursor: "pointer", background: on ? "linear-gradient(180deg, rgba(240,166,58,0.22), rgba(240,166,58,0.08))" : "rgba(8,10,20,0.72)", border: on ? "1px solid #f0a63a" : "1px solid rgba(255,255,255,0.15)", boxShadow: on ? "0 0 18px rgba(240,166,58,0.55)" : "none", transition: "all .15s", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", backdropFilter: "blur(4px)" }}>
              {f === "boulder" ? <span style={{ fontSize: on ? 34 : 26, lineHeight: 1, flex: 1, display: "flex", alignItems: "flex-end", paddingBottom: 4 }}>🪨</span> : <img src={`/descent/portraits/${f}.png`} alt={f} style={{ height: sz - 6, objectFit: "contain", objectPosition: "bottom", filter: on ? "none" : "brightness(0.6) saturate(0.6)", transition: "filter .15s" }} />}
              <span style={{ fontFamily: "'Cinzel', Georgia, serif", fontSize: on ? 10 : 8, letterSpacing: "0.12em", color: on ? "#ffd27a" : "#a29a88", lineHeight: "16px", whiteSpace: "nowrap" }}>{KIT[f].name.toUpperCase()}</span>
            </button>); })}
        </div>
      </div>
      <button type="button" onClick={toggleFs} style={{ position: "absolute", right: 12, bottom: 10, background: "rgba(8,10,20,0.7)", border: "1px solid rgba(240,166,58,0.3)", borderRadius: 8, color: "#e9e2d2", fontSize: 12, padding: "6px 10px", cursor: "pointer" }}>{fs ? "✕ exit" : "⛶ full screen"}</button>
      {hud.msg && <div key={hud.msg} style={{ position: "absolute", top: "18%", left: 0, right: 0, textAlign: "center", pointerEvents: "none", fontFamily: "'Cinzel', Georgia, serif", fontSize: "clamp(16px, 2.6vw, 30px)", fontWeight: 900, letterSpacing: "0.12em", color: "#ffd27a", textShadow: "0 0 24px rgba(240,166,58,0.7), 0 2px 0 #000", animation: "siegeMsg .4s ease-out" }}>{hud.msg}</div>}
      {hud.state === "ready" && hud.intro && !err && (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", fontFamily: "'Cinzel', Georgia, serif", textAlign: "center", background: "linear-gradient(180deg, rgba(5,7,14,0.35), transparent 30%, transparent 70%, rgba(5,7,14,0.6))" }}>
          <div style={{ position: "absolute", top: "30%", left: 0, right: 0, animation: "siegeTitle 11s ease-in-out both" }}>
            <div style={{ fontSize: "clamp(11px, 1.6vw, 16px)", letterSpacing: "0.45em", color: "#e9e2d2", opacity: 0.8, animation: "siegeIntroA 11s ease-in-out both" }}>THE HORDE IS ON THE FIELD</div>
            <div style={{ fontSize: "clamp(34px, 7vw, 84px)", fontWeight: 900, letterSpacing: "0.14em", color: "#ffd27a", textShadow: "0 0 60px rgba(240,166,58,0.55), 0 3px 0 #000", marginTop: 10, animation: "siegeIntroB 11s ease-in-out both" }}>THE SIEGE</div>
            <div style={{ fontSize: "clamp(11px, 1.6vw, 16px)", letterSpacing: "0.4em", color: "#e9e2d2", opacity: 0.85, marginTop: 10, animation: "siegeIntroC 11s ease-in-out both" }}>HOLD THE GATE UNTIL THE HORN</div>
          </div>
          <div style={{ position: "absolute", bottom: 120, left: 0, right: 0, fontSize: 11, letterSpacing: "0.3em", color: "#a29a88" }}>TAP TO SKIP</div>
        </div>
      )}
      {hud.state === "ready" && !hud.intro && !err && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(5,7,14,0.45)", pointerEvents: "none", fontFamily: "'Cinzel', Georgia, serif", textAlign: "center", padding: 20 }}>
          <div style={{ fontSize: "clamp(26px, 5vw, 56px)", fontWeight: 900, letterSpacing: "0.1em", color: "#ffd27a", textShadow: "0 0 40px rgba(240,166,58,0.5)" }}>THE SIEGE</div>
          <div style={{ fontSize: "clamp(11px, 1.6vw, 15px)", letterSpacing: "0.25em", color: "#e9e2d2", opacity: 0.85, marginTop: 8 }}>{mode === "pov" ? "ON THE BATTLEMENTS · HOLD THE GATE FOR 6 WAVES" : "AT THE CATAPULT · HOLD THE GATE FOR 6 WAVES"}</div>
          <div style={{ marginTop: 22, fontSize: "clamp(12px, 1.5vw, 14px)", color: "#a29a88", fontFamily: "system-ui, sans-serif", letterSpacing: "0.02em", maxWidth: 520 }}><>Move to aim at the marker, <b style={{ color: "#e9e2d2" }}>hold</b> to charge, release to {mode === "pov" ? "throw" : "fire the catapult"}. Charged shots unleash your faction's big move. Hit tower bases, crush the ram, keep the crawlers off the wall.</></div>
          <div style={{ marginTop: 24, fontSize: 13, letterSpacing: "0.3em", color: "#ffd27a", animation: "siegePulse 1.4s ease-in-out infinite" }}>{mode === "pov" ? "TAP TO TAKE THE WALL" : "TAP TO MAN THE CATAPULT"}</div>
        </div>
      )}
      {result && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(5,7,14,0.6)", fontFamily: "'Cinzel', Georgia, serif" }}>
          <div style={{ background: "rgba(14,18,32,0.92)", border: "1px solid rgba(240,166,58,0.35)", borderRadius: 14, padding: "26px 34px", textAlign: "center", minWidth: 280 }}>
            <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: "0.1em", color: result.won ? "#ffd27a" : "#e0475b" }}>{result.won ? "THE GATE HELD" : "THE GATE FELL"}</div>
            <div style={{ marginTop: 10, color: "#e9e2d2", fontSize: 14, letterSpacing: "0.08em" }}>SCORE <b style={{ color: "#ffd27a" }}>{result.score}</b> · KILLS <b>{result.kills}</b> · WAVES <b>{result.waves}</b></div>
            <button type="button" onClick={() => { setResult(null); setHud(EMPTY); setGen((g) => g + 1); }} style={{ marginTop: 18, background: "linear-gradient(135deg,#f0a63a,#c9821e)", border: "none", borderRadius: 10, padding: "10px 22px", color: "#1a1206", fontWeight: 900, letterSpacing: "0.15em", cursor: "pointer", fontFamily: "inherit" }}>MAN THE WALL AGAIN</button>
          </div>
        </div>
      )}
      {err && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#e0475b", background: "rgba(0,0,0,0.7)", padding: 20, textAlign: "center", fontSize: 13 }}>The siege engine could not start on this device ({err}). WebGL is required.</div>}
      <style>{`@keyframes siegeMsg { from { opacity:0; transform: translateY(-8px) scale(.96);} to { opacity:1; transform:none; } } @keyframes siegePulse { 0%,100% { opacity:.55 } 50% { opacity:1 } }
        @keyframes siegeTitle { 0%,100% { opacity:1 } }
        @keyframes siegeIntroA { 0%,8% { opacity:0; transform:translateY(6px) } 18%,40% { opacity:.8; transform:none } 50%,100% { opacity:0 } }
        @keyframes siegeIntroB { 0%,30% { opacity:0; letter-spacing:.5em } 42%,88% { opacity:1; letter-spacing:.14em } 100% { opacity:0 } }
        @keyframes siegeIntroC { 0%,48% { opacity:0; transform:translateY(6px) } 58%,88% { opacity:.85; transform:none } 100% { opacity:0 } }`}</style>
    </div>
  );
}
