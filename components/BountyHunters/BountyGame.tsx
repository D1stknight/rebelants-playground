// components/BountyHunters/BountyGame.tsx
// Mounts the canvas engine, forwards keyboard/touch input, draws the HUD in DOM on top.
import React, { useEffect, useRef, useState } from "react";
import { BountyGame, VW, VH, type Hud, type Input } from "./game";
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
  const audio = useBountyAudio();
  const audioRef = useRef(audio); audioRef.current = audio;
  const isTouch = typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);

  useEffect(() => {
    const fit = () => { const w = window.innerWidth, h = window.innerHeight - (isTouch ? 120 : 0); setScale(Math.max(1, Math.floor(Math.min(w / VW, h / VH) * 4) / 4)); };
    fit(); window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit);
  }, [isTouch]);

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const g = new BountyGame(cv, board, {
      onHud: (h) => setHud({ ...h }),
      onSfx: (n) => { const s = (audioRef.current.sfx as any)[n]; if (s) s(); },
      onEnd: (r) => { audioRef.current.music(null); onEnd(r); },
    }, faction);
    gameRef.current = g; (window as any).__bg = g; g.start();
    audioRef.current.music(board.music, 0.35);
    const kd = (e: KeyboardEvent) => { const k = KEYS[e.key]; if (k) { g.input[k] = true; e.preventDefault(); } if (e.key === "Escape") onQuit(); };
    const ku = (e: KeyboardEvent) => { const k = KEYS[e.key]; if (k) { g.input[k] = false; e.preventDefault(); } };
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
    return () => { g.stop(); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); audioRef.current.music(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  const press = (k: keyof Input, v: boolean) => (e: React.PointerEvent) => { e.preventDefault(); const g = gameRef.current; if (g) g.input[k] = v; };
  const btn = (label: string, k: keyof Input, style: React.CSSProperties = {}) => (
    <div onPointerDown={press(k, true)} onPointerUp={press(k, false)} onPointerLeave={press(k, false)} onPointerCancel={press(k, false)} style={{ width: 58, height: 58, borderRadius: 14, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 900, color: "#fff", userSelect: "none", touchAction: "none", ...style }}>{label}</div>
  );

  const bossPct = hud?.bossHp != null ? hud.bossHp / hud.bossMax : null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: FONT, color: "#fff", overflow: "hidden" }}>
      <div style={{ position: "relative", width: VW * scale, height: VH * scale }}>
        <canvas ref={canvasRef} width={VW} height={VH} style={{ width: VW * scale, height: VH * scale, imageRendering: "pixelated", display: "block" }} />
        {/* HUD */}
        {hud && (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div style={{ position: "absolute", top: 8, left: 10, display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 3 }}>{Array.from({ length: Math.max(0, hud.lives) }, (_, i) => <span key={i} style={{ fontSize: 12 * Math.max(1, scale / 2) }}>❤️</span>)}</div>
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
        <button type="button" onClick={audio.toggleMute} style={{ position: "absolute", left: 8, bottom: 8, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, width: 26, height: 26, color: "#fff", fontSize: 12, cursor: "pointer" }}>{audio.muted ? "🔇" : "🔊"}</button>
        <button type="button" onClick={onQuit} style={{ position: "absolute", right: 8, bottom: 8, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(248,113,113,0.4)", borderRadius: 999, padding: "4px 10px", color: "#f87171", fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", cursor: "pointer", fontFamily: FONT }}>✕ QUIT</button>
      </div>
      {!isTouch && <div style={{ marginTop: 8, fontSize: 10, opacity: 0.4, letterSpacing: "0.2em" }}>← → MOVE · ↑ AIM UP · ↓ CROUCH / DROP · Z or SPACE JUMP · X or SHIFT FIRE · ESC QUIT</div>}
      {isTouch && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: 120, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 16px", pointerEvents: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "58px 58px 58px", gridTemplateRows: "58px 58px", gap: 4 }}>
            <div />{btn("▲", "up")}<div />
            {btn("◀", "left")}{btn("▼", "down")}{btn("▶", "right")}
          </div>
          <div style={{ display: "flex", gap: 10 }}>{btn("●", "fire", { background: "rgba(248,113,113,0.25)", width: 66, height: 66, borderRadius: 33 })}{btn("▲", "jump", { background: "rgba(96,165,250,0.25)", width: 66, height: 66, borderRadius: 33 })}</div>
        </div>
      )}
      <style>{`@keyframes bhMsg{0%{opacity:0;transform:scale(1.15)}12%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0}}`}</style>
    </div>
  );
}
