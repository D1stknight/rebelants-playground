// components/BountyHunters/BountyGame.tsx
// Mounts the canvas engine, forwards keyboard/touch input, draws the HUD in DOM on top.
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BountyGame, VW, VW_MAX, VH, type Hud, type Input } from "./game";
import type { Board } from "../../lib/bountyConfig";
import { useBountyAudio } from "../../lib/useBountyAudio";

const FONT = "'Noto Serif JP', 'Hiragino Mincho ProN', serif";
const KEYS: Record<string, keyof Input> = { ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right", ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down", " ": "jump", z: "jump", Z: "jump", j: "jump", J: "jump", x: "fire", X: "fire", k: "fire", K: "fire", Shift: "fire" };

type Props = { board: Board; faction?: string; onEnd: (r: { cleared: boolean; bounty: number; kills: number; boardN: number }) => void; onQuit: () => void };

export default function BountyGameView({ board, faction = "samurai", onEnd, onQuit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<BountyGame | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [scale, setScale] = useState(2);
  const [vw, setVw] = useState(VW);          // view width: 400 on desktop/portrait, up to 480 in phone landscape to fill the screen
  const audio = useBountyAudio();
  const audioRef = useRef(audio); audioRef.current = audio;
  const vwRef = useRef(VW); vwRef.current = vw;
  useEffect(() => { gameRef.current?.setView(vw); }, [vw]);
  const [isTouch, setIsTouch] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [dbg, setDbg] = useState<string | null>(null);
  // iOS Safari: the lobby is scrolled far down when HUNT is tapped; when the tall lobby is replaced by a viewport-sized
  // view, WebKit keeps positioning fixed elements against the stale scroll offset — the game rendered off-screen (music
  // played, screen showed the bare page background). So: normal-flow absolute root sized to the visual viewport, scroll to
  // the top on mount and lock body scrolling while playing.
  const [vh, setVh] = useState<number | string>("100vh");
  useEffect(() => {
    const prevOv = document.body.style.overflow, prevH = document.documentElement.style.height, prevBH = document.body.style.height;
    document.body.style.overflow = "hidden"; document.body.style.height = "100%"; document.documentElement.style.height = "100%";
    const up = () => { window.scrollTo(0, 0); setVh(window.visualViewport?.height || window.innerHeight); };
    up(); const t1 = setTimeout(up, 50), t2 = setTimeout(up, 400);
    window.addEventListener("resize", up); window.addEventListener("orientationchange", up); window.visualViewport?.addEventListener("resize", up);
    return () => { clearTimeout(t1); clearTimeout(t2); document.body.style.overflow = prevOv; document.body.style.height = prevBH; document.documentElement.style.height = prevH; window.removeEventListener("resize", up); window.removeEventListener("orientationchange", up); window.visualViewport?.removeEventListener("resize", up); };
  }, []);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!/[?&]debug/.test(location.search)) return;
    const errs: string[] = [];
    const oe = (e: ErrorEvent) => errs.push("ERR " + e.message); const ur = (e: PromiseRejectionEvent) => errs.push("REJ " + String(e.reason?.message || e.reason));
    window.addEventListener("error", oe); window.addEventListener("unhandledrejection", ur);
    const id = setInterval(() => {
      const r = rootRef.current?.getBoundingClientRect(); const c = canvasRef.current?.getBoundingClientRect(); const g = gameRef.current;
      const cs = rootRef.current ? getComputedStyle(rootRef.current) : null;
      setDbg(JSON.stringify({ win: [innerWidth, innerHeight], vv: window.visualViewport ? [Math.round(window.visualViewport.width), Math.round(window.visualViewport.height), window.visualViewport.scale] : null, dpr: devicePixelRatio, isTouch, portrait, scale, root: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null, rootCss: cs ? [cs.position, cs.display, cs.backgroundColor, cs.zIndex, cs.visibility, cs.opacity] : null, canvas: c ? [Math.round(c.x), Math.round(c.y), Math.round(c.width), Math.round(c.height)] : null, game: g ? { t: Math.round(g.t * 10) / 10, state: g.state, px: Math.round(g.player.x), over: g.over } : null, doc: [document.documentElement.scrollWidth, document.documentElement.scrollHeight, scrollX, scrollY], errs: errs.slice(-5), ua: navigator.userAgent }));
    }, 700);
    return () => { clearInterval(id); window.removeEventListener("error", oe); window.removeEventListener("unhandledrejection", ur); };
  }, [isTouch, portrait, scale]);
  useEffect(() => { setIsTouch("ontouchstart" in window || navigator.maxTouchPoints > 0); }, []);

  useEffect(() => {
    const fit = () => {
      const vv = window.visualViewport; const w = vv?.width || window.innerWidth, h = vv?.height || window.innerHeight;
      const port = h > w; setPortrait(port);
      if (isTouch) {
        if (port) { setVw(VW); setScale(Math.max(0.5, Math.min(w / VW, (h * 0.5) / VH))); }   // portrait: full width, lower half for the pads
        else {                                                                              // landscape: fill the height and widen the view to the screen's aspect
          const nvw = Math.max(VW, Math.min(VW_MAX, Math.round((w / h) * VH)));
          setVw(nvw); setScale(Math.max(0.5, Math.min(w / nvw, h / VH)));
        }
      } else { setVw(VW); setScale(Math.max(1, Math.floor(Math.min(w / VW, h / VH) * 4) / 4)); }
    };
    fit(); window.addEventListener("resize", fit); window.addEventListener("orientationchange", fit); window.visualViewport?.addEventListener("resize", fit);
    return () => { window.removeEventListener("resize", fit); window.removeEventListener("orientationchange", fit); window.visualViewport?.removeEventListener("resize", fit); };
  }, [isTouch]);

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    let g: BountyGame;
    try {
      g = new BountyGame(cv, board, {
        onHud: (h) => setHud({ ...h }),
        onSfx: (n) => { const s = (audioRef.current.sfx as any)[n]; if (s) s(); },
        onEnd: (r) => { audioRef.current.music(null); onEnd(r); },
        onFatal: (m) => setFatal(m),
      }, faction, vwRef.current);
      gameRef.current = g; (window as any).__bg = g; g.start();
    } catch (e: any) { console.error("BountyGame failed to start", e); setFatal(String(e?.message || e)); return; }

    audioRef.current.music(board.music, 0.35);
    const kd = (e: KeyboardEvent) => { const k = KEYS[e.key]; if (k) { g.input[k] = true; e.preventDefault(); } if (e.key === "Escape") onQuit(); };
    const ku = (e: KeyboardEvent) => { const k = KEYS[e.key]; if (k) { g.input[k] = false; e.preventDefault(); } };
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
    return () => { g.stop(); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); audioRef.current.music(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  const [fs, setFs] = useState(false);
  useEffect(() => { const f = () => setFs(!!(document.fullscreenElement || (document as any).webkitFullscreenElement)); f(); document.addEventListener("fullscreenchange", f); document.addEventListener("webkitfullscreenchange", f); return () => { document.removeEventListener("fullscreenchange", f); document.removeEventListener("webkitfullscreenchange", f); }; }, []);
  const canFs = typeof document !== "undefined" && !!((document.documentElement as any).requestFullscreen || (document.documentElement as any).webkitRequestFullscreen);
  const toggleFs = () => { try { if (fs) { (document.exitFullscreen || (document as any).webkitExitFullscreen)?.call(document); } else { const el: any = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el, { navigationUI: "hide" })?.catch?.(() => {}); } } catch {} };
  const press = (k: keyof Input, v: boolean) => (e: React.PointerEvent) => { e.preventDefault(); const g = gameRef.current; if (g) g.input[k] = v; };
  // pad size: 60 px, shrinking on short landscape viewports (iPhone Safari with its toolbars is ~220 px tall)
  const ps = portrait || typeof vh !== "number" ? 60 : Math.round(Math.max(40, Math.min(60, vh * 0.2)));
  const pb = Math.round(ps * 1.23);
  const btn = (label: string, k: keyof Input, style: React.CSSProperties = {}) => (
    <div onPointerDown={press(k, true)} onPointerUp={press(k, false)} onPointerLeave={press(k, false)} onPointerCancel={press(k, false)} style={{ width: ps, height: ps, borderRadius: Math.round(ps * 0.27), background: portrait ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.35)", boxShadow: portrait ? "none" : "0 0 0 1px rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.round(ps * 0.37), fontWeight: 900, color: "#fff", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", touchAction: "none", ...style }}>{label}</div>
  );

  const bossPct = hud?.bossHp != null ? hud.bossHp / hud.bossMax : null;
  return (<>
    {dbg && createPortal(<div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 2147483647, background: "#ffec3d", color: "#000", fontFamily: "monospace", fontSize: 10, padding: 6, wordBreak: "break-all", whiteSpace: "pre-wrap", pointerEvents: "none" }}>{dbg}</div>, document.body)}
    <div ref={rootRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vh, zIndex: 50, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: isTouch && portrait ? "flex-start" : "center", paddingTop: isTouch && portrait ? "env(safe-area-inset-top)" : 0, fontFamily: FONT, color: "#fff", overflow: "hidden", touchAction: "none", WebkitUserSelect: "none", userSelect: "none" }}>
      {fatal && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", background: "rgba(0,0,0,0.85)" }}>
          <div style={{ fontSize: 14, color: "#ff5566", letterSpacing: "0.3em", fontWeight: 800 }}>☠ THE HUNT COULDN'T START</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 10, maxWidth: 420, wordBreak: "break-word" }}>{fatal}</div>
          <button type="button" onClick={onQuit} style={{ marginTop: 18, fontFamily: FONT, padding: "12px 22px", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 12, background: "rgba(255,255,255,0.08)", color: "#fff", fontWeight: 800, letterSpacing: "0.15em" }}>BACK TO LOBBY</button>
        </div>
      )}
      <div style={{ position: "relative", width: vw * scale, height: VH * scale, flex: "0 0 auto" }}>
        <canvas ref={canvasRef} width={vw} height={VH} style={{ width: vw * scale, height: VH * scale, imageRendering: "pixelated", display: "block" }} />
        {/* HUD */}
        {hud && (
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none" }}>
            <div style={{ position: "absolute", top: 8, left: 10, display: "flex", gap: 10, alignItems: "center" }}>
              <div>
                <div style={{ display: "flex", gap: 3 }}>{Array.from({ length: Math.max(0, hud.lives) }, (_, i) => <span key={i} style={{ fontSize: 11 * Math.max(1, scale / 2) }}>❤️</span>)}</div>
                <div style={{ display: "flex", gap: 2, marginTop: 3 }}>{Array.from({ length: hud.maxHp }, (_, i) => <div key={i} style={{ width: 10 * Math.max(1, scale / 2), height: 4 * Math.max(1, scale / 2), background: i < hud.hp ? (hud.hp <= 1 ? "#ff4d4d" : "#7cf07c") : "rgba(255,255,255,0.15)", border: "1px solid rgba(0,0,0,0.7)" }} />)}</div>
              </div>
              <div style={{ fontSize: 9 * Math.max(1, scale / 2), letterSpacing: "0.2em", fontWeight: 800, color: hud.weapon === "rifle" ? "#ddd" : hud.weapon === "spread" ? "#ff7070" : hud.weapon === "laser" ? "#7ad4ff" : "#ffa040" }}>{hud.weapon.toUpperCase()}</div>
            </div>
            <div style={{ position: "absolute", top: 8, right: 10, textAlign: "right" }}>
              <div style={{ fontSize: 11 * Math.max(1, scale / 2), fontWeight: 900, color: "#fbbf24", textShadow: "0 1px 3px #000" }}>💎 {hud.bounty}</div>
              <div style={{ fontSize: 7 * Math.max(1, scale / 2), letterSpacing: "0.25em", opacity: 0.7, marginTop: 2 }}>{hud.board.world}-{hud.board.stage} · {hud.board.name.split(": ")[1].toUpperCase()}</div>
            </div>
            {/* progress */}
            {hud.state !== "boss" && <div style={{ position: "absolute", top: 4, left: "30%", right: "30%", height: 3, background: "rgba(255,255,255,0.15)" }}><div style={{ width: `${hud.progress * 100}%`, height: "100%", background: hud.board.accent }} /></div>}
            {bossPct != null && (
              <div style={{ position: "absolute", top: 6, left: "22%", right: "22%" }}>
                <div style={{ fontSize: 7 * Math.max(1, scale / 2), letterSpacing: "0.3em", textAlign: "center", color: "#ff6b6b", fontWeight: 800 }}>☠ {hud.board.boss.name}</div>
                <div style={{ height: 5 * Math.max(1, scale / 2), background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.3)", marginTop: 2 }}><div style={{ width: `${bossPct * 100}%`, height: "100%", background: "linear-gradient(90deg,#ff3355,#ffb020)", transition: "width .15s" }} /></div>
              </div>
            )}
            {hud.msg && (
              <div style={{ position: "absolute", left: 0, right: 0, top: "38%", textAlign: "center", animation: "bhMsg 2.4s ease-out both" }}>
                <div style={{ fontSize: 16 * Math.max(1, scale / 2), fontWeight: 900, letterSpacing: "0.2em", textShadow: "0 0 20px #000, 0 2px 4px #000", color: hud.state === "gameover" ? "#ff5566" : hud.state === "cleared" ? "#ffd24a" : "#fff" }}>{hud.msg}</div>
              </div>
            )}
            {hud.state === "intro" && (
              <div style={{ position: "absolute", left: 0, right: 0, top: "34%", textAlign: "center", animation: "bhMsg 1.6s ease-out both" }}>
                <div style={{ fontSize: 8 * Math.max(1, scale / 2), letterSpacing: "0.4em", color: hud.board.accent }}>WORLD {hud.board.world} · STAGE {hud.board.stage}</div>
                <div style={{ fontSize: 18 * Math.max(1, scale / 2), fontWeight: 900, letterSpacing: "0.15em", textShadow: "0 2px 6px #000" }}>{hud.board.name.split(": ")[1].toUpperCase()}</div>
                <div style={{ fontSize: 8 * Math.max(1, scale / 2), opacity: 0.75, fontStyle: "italic", marginTop: 4 }}>{hud.board.boss.captain ? "TARGET" : "WANTED"}: {hud.board.boss.name} · {hud.board.boss.bounty} REBEL</div>
              </div>
            )}
          </div>
        )}
        <button type="button" onClick={audio.toggleMute} style={{ position: "absolute", left: 8, ...(isTouch ? { top: 44 } : { bottom: 8 }), background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, width: 26, height: 26, color: "#fff", fontSize: 12, cursor: "pointer" }}>{audio.muted ? "🔇" : "🔊"}</button>
        {canFs && <button type="button" onClick={toggleFs} title="Full screen" style={{ position: "absolute", left: 40, ...(isTouch ? { top: 44 } : { bottom: 8 }), background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, width: 26, height: 26, color: "#fff", fontSize: 12, cursor: "pointer" }}>{fs ? "▣" : "⛶"}</button>}
        <button type="button" onClick={onQuit} style={{ position: "absolute", right: 8, ...(isTouch ? { top: 44 } : { bottom: 8 }), background: "rgba(0,0,0,0.5)", border: "1px solid rgba(248,113,113,0.4)", borderRadius: 999, padding: "4px 10px", color: "#f87171", fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", cursor: "pointer", fontFamily: FONT }}>✕ QUIT</button>
      </div>
      {!isTouch && <div style={{ marginTop: 8, fontSize: 10, opacity: 0.4, letterSpacing: "0.2em" }}>← → MOVE · ↑ AIM UP · ↓ CROUCH / DROP · Z or SPACE JUMP · X or SHIFT FIRE · ESC QUIT</div>}
      {isTouch && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: portrait ? VH * scale + 8 : "auto", height: portrait ? "auto" : 150, display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: portrait ? "0 18px max(40px, env(safe-area-inset-bottom))" : "0 max(14px, env(safe-area-inset-left)) max(14px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-right))", pointerEvents: "none", zIndex: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: `${ps}px ${ps}px ${ps}px`, gridTemplateRows: `${ps}px ${ps}px`, gap: Math.round(ps * 0.1), pointerEvents: "auto", opacity: portrait ? 1 : 0.8 }}>
            <div />{btn("▲", "up")}<div />
            {btn("◀", "left")}{btn("▼", "down")}{btn("▶", "right")}
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-end", pointerEvents: "auto", opacity: portrait ? 1 : 0.8 }}>{btn("●", "fire", { background: portrait ? "rgba(248,113,113,0.3)" : "rgba(180,40,40,0.45)", width: pb, height: pb, borderRadius: pb / 2 })}{btn("▲", "jump", { background: portrait ? "rgba(96,165,250,0.3)" : "rgba(40,80,180,0.45)", width: pb, height: pb, borderRadius: pb / 2, marginBottom: Math.round(pb * 0.35) })}</div>
        </div>
      )}
      {isTouch && portrait && hud && hud.state === "intro" && (
        <div style={{ position: "absolute", left: 0, right: 0, top: VH * scale + 14, textAlign: "center", fontSize: 10, letterSpacing: "0.25em", color: "rgba(255,255,255,0.45)", pointerEvents: "none" }}>⟳ ROTATE FOR A BIGGER VIEW</div>
      )}
      <style>{`@keyframes bhMsg{0%{opacity:0;transform:scale(1.15)}12%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0}}`}</style>
    </div>
  </>);
}
