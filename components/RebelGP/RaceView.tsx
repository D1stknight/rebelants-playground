// components/RebelGP/RaceView.tsx
// Mounts the Mode 7 race engine, forwards keyboard/touch, draws the HUD (DOM) on top. Same mobile rules as Bounty Hunters:
// absolute root sized to the visual viewport, body scroll locked, pads overlaid in landscape / below in portrait.
import React, { useEffect, useRef, useState } from "react";
import { Race, VW, VW_MAX, VH, loadTrack, type Hud, type Input, ord } from "./engine";
import { CHASSIS, ITEMS, type ChassisId, TRACKS } from "../../lib/rgpConfig";
import { useBountyAudio } from "../../lib/useBountyAudio";

const FONT = "'Noto Serif JP', 'Hiragino Mincho ProN', serif";
const KEYS: Record<string, keyof Input> = { ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right", ArrowUp: "accel", w: "accel", W: "accel", ArrowDown: "brake", s: "brake", S: "brake", " ": "drift", z: "drift", Z: "drift", j: "drift", J: "drift", x: "item", X: "item", k: "item", K: "item", Shift: "item" };

type Props = { trackId: string; faction: string; chassis: ChassisId; onEnd: (r: { place: number; time: number }) => void; onQuit: () => void };

export default function RaceView({ trackId, faction, chassis, onEnd, onQuit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const raceRef = useRef<Race | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [scale, setScale] = useState(2);
  const [vw, setVw] = useState(VW); const vwRef = useRef(VW); vwRef.current = vw;
  useEffect(() => { raceRef.current?.setView(vw); }, [vw]);
  const [isTouch, setIsTouch] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [vh, setVh] = useState<number | string>("100vh");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const audio = useBountyAudio(); const audioRef = useRef(audio); audioRef.current = audio;
  const track = TRACKS.find((t) => t.id === trackId)!;

  useEffect(() => { setIsTouch("ontouchstart" in window || navigator.maxTouchPoints > 0); }, []);
  useEffect(() => {
    const prevOv = document.body.style.overflow, prevH = document.documentElement.style.height, prevBH = document.body.style.height;
    document.body.style.overflow = "hidden"; document.body.style.height = "100%"; document.documentElement.style.height = "100%";
    const up = () => {
      window.scrollTo(0, 0); const vv = window.visualViewport; const w = vv?.width || window.innerWidth, h = vv?.height || window.innerHeight; setVh(h);
      const port = h > w; setPortrait(port);
      const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
      if (touch) {
        if (port) { setVw(VW); setScale(Math.max(0.5, Math.min(w / VW, (h * 0.55) / VH))); }
        else { const nvw = Math.max(VW, Math.min(VW_MAX, Math.round((w / h) * VH))); setVw(nvw); setScale(Math.max(0.5, Math.min(w / nvw, h / VH))); }
      } else { setVw(VW); setScale(Math.max(1, Math.floor(Math.min(w / VW, h / VH) * 4) / 4)); }
    };
    up(); const t1 = setTimeout(up, 50), t2 = setTimeout(up, 400);
    window.addEventListener("resize", up); window.addEventListener("orientationchange", up); window.visualViewport?.addEventListener("resize", up);
    return () => { clearTimeout(t1); clearTimeout(t2); document.body.style.overflow = prevOv; document.body.style.height = prevBH; document.documentElement.style.height = prevH; window.removeEventListener("resize", up); window.removeEventListener("orientationchange", up); window.visualViewport?.removeEventListener("resize", up); };
  }, []);

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return; let dead = false; let r: Race | null = null;
    loadTrack(trackId).then((loaded) => {
      if (dead) return;
      r = new Race(cv, loaded, {
        onHud: (h) => setHud({ ...h }),
        onSfx: (n) => { const s = (SFX as any)[n]; if (s) s(audioRef.current); },
        onEnd: (res) => { audioRef.current.music(null); onEnd(res); },
      }, faction, chassis);
      r.setView(vwRef.current); raceRef.current = r; (window as any).__gp = r; r.start(); setReady(true);
      audioRef.current.music(track.cup >= 3 ? "fw-battle-epic" : "hd-war", 0.3);
    }).catch((e) => { console.error(e); setLoadErr(String(e?.message || e)); });
    const kd = (e: KeyboardEvent) => { const k = KEYS[e.key]; const g = raceRef.current; if (k && g) { g.input[k] = true; e.preventDefault(); } if (e.key === "Escape") onQuit(); };
    const ku = (e: KeyboardEvent) => { const k = KEYS[e.key]; const g = raceRef.current; if (k && g) { g.input[k] = false; e.preventDefault(); } };
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
    return () => { dead = true; r?.stop(); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); audioRef.current.music(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  // touch: auto-accelerate; pads = steer left/right, drift, item
  useEffect(() => { const g = raceRef.current; if (g && isTouch) g.input.accel = true; }, [isTouch, ready]);
  const press = (k: keyof Input, v: boolean) => (e: React.PointerEvent) => { e.preventDefault(); const g = raceRef.current; if (g) g.input[k] = v; if (g && isTouch) g.input.accel = true; };
  const ps = portrait || typeof vh !== "number" ? 64 : Math.round(Math.max(44, Math.min(64, vh * 0.2))); const pb = Math.round(ps * 1.2);
  const btn = (label: string, k: keyof Input, style: React.CSSProperties = {}) => (
    <div onPointerDown={press(k, true)} onPointerUp={press(k, false)} onPointerLeave={press(k, false)} onPointerCancel={press(k, false)} style={{ width: ps, height: ps, borderRadius: Math.round(ps * 0.27), background: portrait ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.round(ps * 0.36), fontWeight: 900, color: "#fff", userSelect: "none", WebkitUserSelect: "none", touchAction: "none", ...style }}>{label}</div>
  );
  const S = Math.max(1, scale / 2);
  const rankColor = hud ? (hud.rank === 1 ? "#ffd700" : hud.rank <= 3 ? "#e0e0e0" : "#fff") : "#fff";

  return (
    <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vh, zIndex: 50, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: isTouch && portrait ? "flex-start" : "center", paddingTop: isTouch && portrait ? "env(safe-area-inset-top)" : 0, fontFamily: FONT, color: "#fff", overflow: "hidden", touchAction: "none", WebkitUserSelect: "none", userSelect: "none" }}>
      {loadErr && <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", background: "rgba(0,0,0,0.85)" }}><div style={{ fontSize: 14, color: "#ff5566", letterSpacing: "0.3em", fontWeight: 800 }}>☠ THE TRACK COULDN'T LOAD</div><div style={{ fontSize: 11, opacity: 0.6, marginTop: 10, maxWidth: 420, wordBreak: "break-word" }}>{loadErr}</div><button type="button" onClick={onQuit} style={{ marginTop: 18, fontFamily: FONT, padding: "12px 22px", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 12, background: "rgba(255,255,255,0.08)", color: "#fff", fontWeight: 800, letterSpacing: "0.15em" }}>BACK TO PADDOCK</button></div>}
      <div style={{ position: "relative", width: vw * scale, height: VH * scale, flex: "0 0 auto" }}>
        <canvas ref={canvasRef} width={vw} height={VH} style={{ width: vw * scale, height: VH * scale, imageRendering: "pixelated", display: "block" }} />
        {!ready && !loadErr && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#a78bfa", letterSpacing: "0.3em", fontSize: 12 }}>LOADING {track.name.toUpperCase()}…</div>}
        {hud && (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            {/* rank + lap */}
            <div style={{ position: "absolute", left: 10, top: 8 }}>
              <div style={{ fontSize: 26 * S, fontWeight: 900, color: rankColor, textShadow: "0 2px 4px #000, 0 0 12px rgba(0,0,0,0.8)", lineHeight: 1 }}>{ord(hud.rank)}<span style={{ fontSize: 10 * S, opacity: 0.7 }}> / 8</span></div>
              <div style={{ fontSize: 9 * S, letterSpacing: "0.25em", fontWeight: 800, marginTop: 4, textShadow: "0 1px 3px #000" }}>LAP {hud.lap}/{hud.laps}</div>
            </div>
            {/* item slot */}
            <div style={{ position: "absolute", right: 10, top: 8, textAlign: "right" }}>
              <div style={{ width: 34 * S, height: 34 * S, marginLeft: "auto", borderRadius: 8 * S, background: "rgba(0,0,0,0.55)", border: `2px solid ${hud.item ? "#ffd166" : "rgba(255,255,255,0.3)"}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxShadow: hud.item ? "0 0 14px rgba(255,209,102,0.5)" : "none" }}>
                {(hud.item || hud.roulette) && <div style={{ width: 28 * S, height: 28 * S, backgroundImage: "url(/rgp/props.png)", backgroundSize: `${8 * 28 * S}px ${4 * 28 * S}px`, backgroundPosition: itemBg(hud.roulette ? Math.floor(Date.now() / 90) % 7 : ITEMS[hud.item!].icon, 28 * S), imageRendering: "pixelated" }} />}
              </div>
              <div style={{ fontSize: 7 * S, letterSpacing: "0.2em", marginTop: 3, color: "#ffd166", fontWeight: 800, textShadow: "0 1px 2px #000" }}>{hud.item ? ITEMS[hud.item].name.toUpperCase() : hud.roulette ? "…" : ""}</div>
              <div style={{ fontSize: 8 * S, letterSpacing: "0.2em", opacity: 0.7, marginTop: 2, fontVariantNumeric: "tabular-nums", textShadow: "0 1px 2px #000" }}>{fmt(hud.t)}</div>
            </div>
            {/* minimap */}
            <div style={{ position: "absolute", ...(isTouch && !portrait ? { left: "50%", top: 6, marginLeft: -28 * S } : { right: 8, bottom: 8 }), width: 56 * S, height: 56 * S, borderRadius: 6, backgroundImage: `url(/rgp/tracks/${trackId}/thumb.png)`, backgroundSize: "cover", border: "1px solid rgba(255,255,255,0.3)", opacity: 0.9, overflow: "hidden" }}>
              {hud.minimap.map((m, i) => <div key={i} style={{ position: "absolute", left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: m.you ? 6 * S : 4 * S, height: m.you ? 6 * S : 4 * S, marginLeft: m.you ? -3 * S : -2 * S, marginTop: m.you ? -3 * S : -2 * S, borderRadius: "50%", background: m.you ? "#ffd166" : "#ff5566", border: "1px solid #000", zIndex: m.you ? 2 : 1 }} />)}
            </div>
            {/* standings (desktop only) */}
            {!isTouch && <div style={{ position: "absolute", left: 10, bottom: 8, fontSize: 7 * S, lineHeight: 1.5, textShadow: "0 1px 2px #000", opacity: 0.85 }}>{hud.standings.slice(0, 8).map((s) => <div key={s.name + s.rank} style={{ color: s.you ? "#ffd166" : "#fff", fontWeight: s.you ? 900 : 500 }}>{s.rank}. {s.name}{s.finished ? " ✓" : ""}</div>)}</div>}
            {/* countdown / messages */}
            {hud.state === "countdown" && hud.countdown > 0 && <div style={{ position: "absolute", left: 0, right: 0, top: "30%", textAlign: "center", fontSize: 48 * S, fontWeight: 900, color: hud.countdown === 1 ? "#ffd166" : "#fff", textShadow: "0 0 24px #000, 0 3px 6px #000", animation: "gpPop .9s ease-out both" }} key={hud.countdown}>{hud.countdown}</div>}
            {hud.msg && <div style={{ position: "absolute", left: 0, right: 0, top: "34%", textAlign: "center", animation: "gpMsg 2.2s ease-out both" }} key={hud.msg}><div style={{ fontSize: 20 * S, fontWeight: 900, letterSpacing: "0.2em", textShadow: "0 0 20px #000, 0 2px 4px #000", color: hud.state === "finished" ? "#ffd166" : "#fff" }}>{hud.msg}</div></div>}
            {hud.state === "intro" && <div style={{ position: "absolute", left: 0, right: 0, top: "52%", textAlign: "center", animation: "gpMsg 1.8s ease-out both" }}><div style={{ fontSize: 8 * S, letterSpacing: "0.4em", opacity: 0.8 }}>CUP {track.cup} · RACE {((track.n - 1) % 3) + 1} · {track.diff <= 5 ? "ROOKIE" : track.diff <= 10 ? "VETERAN" : "ELITE"}</div></div>}
          </div>
        )}
        <button type="button" onClick={audio.toggleMute} style={{ position: "absolute", left: 8, top: 44 * S + 10, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, width: 26, height: 26, color: "#fff", fontSize: 12, cursor: "pointer" }}>{audio.muted ? "🔇" : "🔊"}</button>
        <button type="button" onClick={onQuit} style={{ position: "absolute", left: 40, top: 44 * S + 10, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(248,113,113,0.4)", borderRadius: 999, padding: "4px 10px", color: "#f87171", fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", cursor: "pointer", fontFamily: FONT }}>✕ QUIT</button>
      </div>
      {!isTouch && <div style={{ marginTop: 8, fontSize: 10, opacity: 0.4, letterSpacing: "0.2em" }}>↑ GAS · ← → STEER · ↓ BRAKE · SPACE / Z DRIFT (hold while turning, release for a turbo) · X / SHIFT ITEM · ESC QUIT</div>}
      {isTouch && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: portrait ? VH * scale + 8 : "auto", height: portrait ? "auto" : 160, display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: portrait ? "0 18px max(40px, env(safe-area-inset-bottom))" : "0 max(14px, env(safe-area-inset-left)) max(14px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-right))", pointerEvents: "none", zIndex: 10 }}>
          <div style={{ display: "flex", gap: Math.round(ps * 0.15), pointerEvents: "auto", opacity: portrait ? 1 : 0.8 }}>{btn("◀", "left", { width: pb, height: pb })}{btn("▶", "right", { width: pb, height: pb })}</div>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-end", pointerEvents: "auto", opacity: portrait ? 1 : 0.8 }}>{btn("★", "item", { background: portrait ? "rgba(255,209,102,0.3)" : "rgba(180,140,40,0.45)", width: pb, height: pb, borderRadius: pb / 2 })}{btn("⤴", "drift", { background: portrait ? "rgba(96,165,250,0.3)" : "rgba(40,80,180,0.45)", width: pb, height: pb, borderRadius: pb / 2, marginBottom: Math.round(pb * 0.35) })}</div>
        </div>
      )}
      {isTouch && portrait && hud && hud.state === "intro" && <div style={{ position: "absolute", left: 0, right: 0, top: VH * scale + 14, textAlign: "center", fontSize: 10, letterSpacing: "0.25em", color: "rgba(255,255,255,0.45)", pointerEvents: "none" }}>⟳ ROTATE FOR THE FULL TRACK · GAS IS AUTOMATIC</div>}
      <style>{`@keyframes gpMsg{0%{opacity:0;transform:scale(1.15)}12%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0}}@keyframes gpPop{0%{opacity:0;transform:scale(1.6)}20%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(0.9)}}`}</style>
    </div>
  );
}

const ITEM_PROP: Record<string, number> = { slick: 12, shell: 13, wasp: 18, spore: 20, nectar: 22, shield: 21, wrath: 19 };
const ITEM_ORDER = ["slick", "shell", "wasp", "spore", "nectar", "shield", "wrath"];
function itemBg(icon: number, cell: number) { const id = ITEM_PROP[ITEM_ORDER[icon]] ?? 12; return `-${(id % 8) * cell}px -${Math.floor(id / 8) * cell}px`; }
function fmt(t: number) { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, "0")}`; }
const SFX: Record<string, (a: ReturnType<typeof useBountyAudio>) => void> = {
  count: (a) => a.play("fw-card-flip", 0.5), go: (a) => a.play("fw-territory-win", 0.7), hop: (a) => a.play("fw-trick-dodge", 0.3, 120), turbo: (a) => a.play("fw-magic-cast", 0.5), boost: (a) => a.play("fw-crate-reward", 0.5, 300),
  bump: (a) => a.play("fw-hit-light", 0.3, 150), splash: (a) => a.play("ant-die", 0.6), hit: (a) => a.play("spider-hit", 0.6, 200), spore: (a) => a.play("fw-ambush", 0.6), box: (a) => a.play("collect-crumb", 0.5), item: (a) => a.play("fw-crate-open", 0.5), use: (a) => a.play("fw-card-deselect", 0.4),
  wrath: (a) => a.play("fw-ambush", 0.8), lap: (a) => a.play("fw-heal", 0.5), win: (a) => a.play("fw-win", 0.8), lose: (a) => a.play("fw-lose", 0.8), shieldpop: (a) => a.play("fw-clash", 0.6),
};
