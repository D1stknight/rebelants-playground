// components/Siege/SiegeView.tsx — phase 1 solo drill: canvas + DOM HUD. The engine (PixiJS + planck) is loaded on the client only.
import React, { useEffect, useRef, useState } from "react";
import type { Hud } from "./engine";

const EMPTY: Hud = { gate: 1000, gateMax: 1000, wave: 0, waves: 6, horde: 0, score: 0, kills: 0, reload: 0, state: "ready", msg: null };

export default function SiegeView() {
  const wrapRef = useRef<HTMLDivElement | null>(null); const canvasRef = useRef<HTMLCanvasElement | null>(null); const engRef = useRef<any>(null);
  const [hud, setHud] = useState<Hud>(EMPTY); const [result, setResult] = useState<{ won: boolean; score: number; kills: number; waves: number } | null>(null); const [err, setErr] = useState<string | null>(null); const [gen, setGen] = useState(0);
  const [fs, setFs] = useState(false);

  useEffect(() => {
    let alive = true; let eng: any = null;
    (async () => {
      try {
        const mod = await import("./engine"); if (!alive || !canvasRef.current) return;
        eng = new mod.Siege(canvasRef.current, { onHud: (h) => { if (alive) setHud(h); }, onEnd: (r) => { if (alive) setResult(r); } });
        engRef.current = eng; await eng.init();
      } catch (e: any) { console.error(e); if (alive) setErr(e?.message || String(e)); }
    })();
    return () => { alive = false; try { eng?.destroy(); } catch {} engRef.current = null; };
  }, [gen]);

  const toggleFs = async () => { const el = wrapRef.current; if (!el) return; try { if (!document.fullscreenElement) { await el.requestFullscreen?.(); setFs(true); } else { await document.exitFullscreen?.(); setFs(false); } } catch {} };
  useEffect(() => { const h = () => setFs(!!document.fullscreenElement); document.addEventListener("fullscreenchange", h); return () => document.removeEventListener("fullscreenchange", h); }, []);

  const gatePct = Math.max(0, Math.min(100, (hud.gate / hud.gateMax) * 100)); const gateColor = gatePct > 60 ? "#5fc78a" : gatePct > 30 ? "#f0a63a" : "#e0475b";
  const pill: React.CSSProperties = { background: "rgba(8,10,20,0.72)", border: "1px solid rgba(240,166,58,0.25)", borderRadius: 8, padding: "6px 12px", fontSize: 12, letterSpacing: "0.08em", color: "#e9e2d2", fontWeight: 700, whiteSpace: "nowrap", backdropFilter: "blur(4px)" };

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", aspectRatio: fs ? undefined : "52 / 22", height: fs ? "100%" : undefined, background: "#0b0e17", borderRadius: fs ? 0 : 16, overflow: "hidden", border: fs ? "none" : "1px solid rgba(240,166,58,0.18)", boxShadow: fs ? "none" : "0 20px 60px rgba(0,0,0,0.55)", touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", touchAction: "none" }} />
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
          <div style={{ fontSize: 10, opacity: 0.8, marginBottom: 4 }}>{hud.reload > 0 ? "RELOADING" : "READY — DRAG TO AIM"}</div>
          <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}><div style={{ width: `${(1 - hud.reload) * 100}%`, height: "100%", background: hud.reload > 0 ? "#a29a88" : "#ffd27a" }} /></div>
        </div>
      </div>
      <button type="button" onClick={toggleFs} style={{ position: "absolute", right: 12, bottom: 10, background: "rgba(8,10,20,0.7)", border: "1px solid rgba(240,166,58,0.3)", borderRadius: 8, color: "#e9e2d2", fontSize: 12, padding: "6px 10px", cursor: "pointer" }}>{fs ? "✕ exit" : "⛶ full screen"}</button>
      {hud.msg && <div key={hud.msg} style={{ position: "absolute", top: "18%", left: 0, right: 0, textAlign: "center", pointerEvents: "none", fontFamily: "'Cinzel', Georgia, serif", fontSize: "clamp(16px, 2.6vw, 30px)", fontWeight: 900, letterSpacing: "0.12em", color: "#ffd27a", textShadow: "0 0 24px rgba(240,166,58,0.7), 0 2px 0 #000", animation: "siegeMsg .4s ease-out" }}>{hud.msg}</div>}
      {hud.state === "ready" && !err && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(5,7,14,0.55)", pointerEvents: "none", fontFamily: "'Cinzel', Georgia, serif", textAlign: "center", padding: 20 }}>
          <div style={{ fontSize: "clamp(26px, 5vw, 56px)", fontWeight: 900, letterSpacing: "0.1em", color: "#ffd27a", textShadow: "0 0 40px rgba(240,166,58,0.5)" }}>THE SIEGE</div>
          <div style={{ fontSize: "clamp(11px, 1.6vw, 15px)", letterSpacing: "0.25em", color: "#e9e2d2", opacity: 0.85, marginTop: 8 }}>SOLO DRILL · HOLD THE GATE FOR 6 WAVES</div>
          <div style={{ marginTop: 22, fontSize: "clamp(12px, 1.5vw, 14px)", color: "#a29a88", fontFamily: "system-ui, sans-serif", letterSpacing: "0.02em", maxWidth: 520 }}>Press anywhere and drag <b style={{ color: "#e9e2d2" }}>back</b> like a slingshot, release to fire. Hit tower bases to topple them, crush the ram, keep crawlers off the gate.</div>
          <div style={{ marginTop: 24, fontSize: 13, letterSpacing: "0.3em", color: "#ffd27a", animation: "siegePulse 1.4s ease-in-out infinite" }}>TAP TO MAN THE CATAPULT</div>
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
      <style>{`@keyframes siegeMsg { from { opacity:0; transform: translateY(-8px) scale(.96);} to { opacity:1; transform:none; } } @keyframes siegePulse { 0%,100% { opacity:.55 } 50% { opacity:1 } }`}</style>
    </div>
  );
}
