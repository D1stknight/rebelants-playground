// components/AntTunnel/TunnelRun.tsx
// Canvas board for Ant Tunnel: inline on desktop (whole maze), full-screen with a follow camera + d-pad on phones.
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Tunnel, loadSprites, type Cfg, type Dir, type EndResult, type Hud, type Theme, COLS, ROWS, CELL } from "./tunnelEngine";

type Props = {
  layout: string[]; layouts?: string[][]; layoutIdx?: number; theme: Theme; cfg: Cfg; playing: boolean; faction?: string;
  onHud: (h: Hud) => void; onEnd: (r: EndResult) => void; onSfx: (n: string) => void; onQuit?: () => void;
  hudLine?: React.ReactNode;
};

export default function TunnelRun({ layout, layouts, layoutIdx = 0, theme, cfg, playing, faction = "samurai", onHud, onEnd, onSfx, onQuit, hudLine }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null); const wrapRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Tunnel | null>(null); const spritesRef = useRef(loadSprites(faction)); const facRef = useRef(faction);
  if (facRef.current !== faction) { facRef.current = faction; spritesRef.current = loadSprites(faction); }
  const [isTouch, setIsTouch] = useState(false); const [vh, setVh] = useState<number | string>("100vh"); const [portrait, setPortrait] = useState(false);
  const cbRef = useRef({ onHud, onEnd, onSfx }); cbRef.current = { onHud, onEnd, onSfx };
  useEffect(() => { setIsTouch("ontouchstart" in window || navigator.maxTouchPoints > 0); }, []);
  const fullscreen = isTouch && playing;

  // (re)create the game whenever a run starts or the layout changes
  const runKey = `${layout.join("|")}|${playing ? "p" : "i"}|${faction}`;
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const g = new Tunnel(cv, layout, theme, cfg, { onHud: (h) => cbRef.current.onHud(h), onEnd: (r) => cbRef.current.onEnd(r), onSfx: (n) => cbRef.current.onSfx(n) }, spritesRef.current, layouts, layoutIdx);
    gameRef.current = g; (window as any).__tun = g; g.start(); if (playing) g.play();
    return () => { g.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  // sizing: inline → fit the wrapper width at the board aspect; fullscreen → visual viewport + follow camera
  useEffect(() => {
    const fit = () => {
      const g = gameRef.current; if (!g) return;
      if (fullscreen) { const vv = window.visualViewport; const w = vv?.width || window.innerWidth, h = vv?.height || window.innerHeight; setVh(h); setPortrait(h > w); g.setView(w * Math.min(2, window.devicePixelRatio || 1), h * Math.min(2, window.devicePixelRatio || 1), true); }
      else { const w = wrapRef.current?.clientWidth || COLS * CELL; const h = w * (ROWS / COLS); const dpr = Math.min(2, window.devicePixelRatio || 1); g.setView(w * dpr, h * dpr, false); }
    };
    fit(); const t = setTimeout(fit, 60);
    window.addEventListener("resize", fit); window.addEventListener("orientationchange", fit); window.visualViewport?.addEventListener("resize", fit);
    return () => { clearTimeout(t); window.removeEventListener("resize", fit); window.removeEventListener("orientationchange", fit); window.visualViewport?.removeEventListener("resize", fit); };
  }, [fullscreen, runKey]);

  // body scroll lock while fullscreen (iOS: body is a clip box — see Bounty Hunters)
  useEffect(() => {
    if (!fullscreen) return;
    const prev = { ov: document.body.style.overflow, bh: document.body.style.height, hh: document.documentElement.style.height };
    document.body.style.overflow = "hidden"; document.body.style.height = "100%"; document.documentElement.style.height = "100%"; window.scrollTo(0, 0);
    const t = setTimeout(() => window.scrollTo(0, 0), 60);
    return () => { clearTimeout(t); document.body.style.overflow = prev.ov; document.body.style.height = prev.bh; document.documentElement.style.height = prev.hh; };
  }, [fullscreen]);

  // keyboard
  useEffect(() => {
    const map: Record<string, Dir | "break"> = { ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down", ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right", " ": "break" };
    const kd = (e: KeyboardEvent) => { const k = map[e.key]; const g = gameRef.current; if (!k || !g) return; e.preventDefault(); if (k === "break") g.input.break = true; else { (["up", "down", "left", "right"] as Dir[]).forEach((d) => (g.input[d] = false)); g.input[k] = true; } };
    const ku = (e: KeyboardEvent) => { const k = map[e.key]; const g = gameRef.current; if (!k || !g) return; if (k === "break") g.input.break = false; else g.input[k] = false; };
    window.addEventListener("keydown", kd, { passive: false }); window.addEventListener("keyup", ku);
    return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
  }, []);

  // swipe on the canvas = set direction
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTS = (e: React.TouchEvent) => { const t = e.touches[0]; if (t) touchStart.current = { x: t.clientX, y: t.clientY }; };
  const onTM = (e: React.TouchEvent) => { const s = touchStart.current; const t = e.touches[0]; const g = gameRef.current; if (!s || !t || !g) return; const dx = t.clientX - s.x, dy = t.clientY - s.y; if (Math.hypot(dx, dy) < 24) return; const d: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up"; g.ant.want = d; g.facing = d; touchStart.current = { x: t.clientX, y: t.clientY }; };
  const press = (k: Dir | "break", v: boolean) => (e: React.PointerEvent) => { e.preventDefault(); const g = gameRef.current; if (!g) return; if (k === "break") g.input.break = v; else { if (v) (["up", "down", "left", "right"] as Dir[]).forEach((d) => (g.input[d] = false)); g.input[k] = v; } };
  const ps = 58;
  const btn = (label: string, k: Dir | "break", style: React.CSSProperties = {}) => (
    <div onPointerDown={press(k, true)} onPointerUp={press(k, false)} onPointerLeave={press(k, false)} onPointerCancel={press(k, false)} style={{ width: ps, height: ps, borderRadius: 14, background: "rgba(0,0,0,0.45)", border: "1px solid rgba(255,255,255,0.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900, color: "#fff", userSelect: "none", WebkitUserSelect: "none", touchAction: "none", ...style }}>{label}</div>
  );

  const canvas = <canvas ref={canvasRef} onTouchStart={onTS} onTouchMove={onTM} style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }} />;
  if (!fullscreen) {
    return <div ref={wrapRef} style={{ width: "100%", aspectRatio: `${COLS} / ${ROWS}`, borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)", background: "#07070c", boxShadow: "0 12px 40px rgba(0,0,0,0.45)" }}>{canvas}</div>;
  }
  // full-screen on phones: portal to body so no lobby container can clip it (position absolute + body height 100% — see Bounty Hunters notes)
  return createPortal(
    <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vh, zIndex: 60, background: "#07070c", overflow: "hidden", touchAction: "none", WebkitUserSelect: "none", userSelect: "none" }}>
      <div style={{ position: "absolute", inset: 0 }}>{canvas}</div>
      {hudLine && <div style={{ position: "absolute", top: "max(8px, env(safe-area-inset-top))", left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}>{hudLine}</div>}
      {onQuit && <button type="button" onClick={onQuit} style={{ position: "absolute", top: "max(8px, env(safe-area-inset-top))", right: 8, background: "rgba(0,0,0,0.55)", border: "1px solid rgba(248,113,113,0.4)", borderRadius: 999, padding: "5px 10px", color: "#f87171", fontSize: 10, fontWeight: 800, letterSpacing: "0.12em" }}>✕ QUIT</button>}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: `0 max(14px, env(safe-area-inset-left)) max(${portrait ? 28 : 14}px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-right))`, pointerEvents: "none" }}>
        <div style={{ display: "grid", gridTemplateColumns: `${ps}px ${ps}px ${ps}px`, gridTemplateRows: `${ps}px ${ps}px ${ps}px`, gap: 5, pointerEvents: "auto", opacity: 0.85 }}>
          <div />{btn("▲", "up")}<div />
          {btn("◀", "left")}<div />{btn("▶", "right")}
          <div />{btn("▼", "down")}<div />
        </div>
        <div style={{ pointerEvents: "auto", opacity: 0.9 }}>{btn("⛏", "break", { width: 78, height: 78, borderRadius: 39, background: "rgba(251,191,36,0.3)", fontSize: 28 })}</div>
      </div>
    </div>,
    document.body
  );
}
