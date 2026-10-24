// components/RebelGP/RaceView.tsx
// Mounts the Mode 7 race engine, forwards keyboard/touch, draws the HUD (DOM) on top. Same mobile rules as Bounty Hunters:
// absolute root sized to the visual viewport, body scroll locked, pads overlaid in landscape / below in portrait.
import React, { useEffect, useRef, useState } from "react";
import { Race, VW, VW_MAX, VH, RES, loadTrack, type Hud, type Input } from "./engine";
import { ITEMS, type ChassisId, TRACKS, FACTION_PAINT, CUPS } from "../../lib/rgpConfig";
import { useBountyAudio } from "../../lib/useBountyAudio";

const FONT = "'Noto Serif JP', 'Hiragino Mincho ProN', serif";
const TV = "'Titillium Web', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";   // broadcast graphics face
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
      r.setView(vwRef.current); r.touch = "ontouchstart" in window || navigator.maxTouchPoints > 0; raceRef.current = r; (window as any).__gp = r; r.start(); setReady(true);
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
  useEngineNote(hud, audio.muted);

  return (
    <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vh, zIndex: 50, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: isTouch && portrait ? "flex-start" : "center", paddingTop: isTouch && portrait ? "env(safe-area-inset-top)" : 0, fontFamily: FONT, color: "#fff", overflow: "hidden", touchAction: "none", WebkitUserSelect: "none", userSelect: "none" }}>
      {loadErr && <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", background: "rgba(0,0,0,0.85)" }}><div style={{ fontSize: 14, color: "#ff5566", letterSpacing: "0.3em", fontWeight: 800 }}>☠ THE TRACK COULDN'T LOAD</div><div style={{ fontSize: 11, opacity: 0.6, marginTop: 10, maxWidth: 420, wordBreak: "break-word" }}>{loadErr}</div><button type="button" onClick={onQuit} style={{ marginTop: 18, fontFamily: FONT, padding: "12px 22px", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 12, background: "rgba(255,255,255,0.08)", color: "#fff", fontWeight: 800, letterSpacing: "0.15em" }}>BACK TO PADDOCK</button></div>}
      <div style={{ position: "relative", width: vw * scale, height: VH * scale, flex: "0 0 auto" }}>
        <canvas ref={canvasRef} width={vw * RES} height={VH * RES} style={{ width: vw * scale, height: VH * scale, display: "block" }} />
        {!ready && !loadErr && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#a78bfa", letterSpacing: "0.3em", fontSize: 12 }}>LOADING {track.name.toUpperCase()}…</div>}
        {hud && <Broadcast hud={hud} S={S} vw={vw * scale} h={VH * scale} touch={isTouch} portrait={portrait} track={track} centre={raceRef.current?.track.center || null} />}
        <button type="button" onClick={audio.toggleMute} style={{ position: "absolute", right: 76, top: 8, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, width: 26, height: 26, color: "#fff", fontSize: 12, cursor: "pointer" }}>{audio.muted ? "🔇" : "🔊"}</button>
        <button type="button" onClick={onQuit} style={{ position: "absolute", right: 8, top: 8, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(248,113,113,0.4)", borderRadius: 999, padding: "4px 10px", color: "#f87171", fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", cursor: "pointer", fontFamily: FONT }}>✕ QUIT</button>
      </div>
      {!isTouch && <div style={{ marginTop: 8, fontSize: 10, opacity: 0.4, letterSpacing: "0.2em" }}>↑ GAS · ← → STEER · ↓ BRAKE · SPACE / Z DRIFT (hold while turning, release for a turbo) · X / SHIFT ITEM · ESC QUIT</div>}
      {isTouch && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: portrait ? VH * scale + 8 : "auto", height: portrait ? "auto" : 160, display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: portrait ? "0 18px max(40px, env(safe-area-inset-bottom))" : "0 max(14px, env(safe-area-inset-left)) max(14px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-right))", pointerEvents: "none", zIndex: 10 }}>
          <div style={{ display: "flex", gap: Math.round(ps * 0.15), pointerEvents: "auto", opacity: portrait ? 1 : 0.8 }}>{btn("◀", "left", { width: pb, height: pb })}{btn("▶", "right", { width: pb, height: pb })}</div>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-end", pointerEvents: "auto", opacity: portrait ? 1 : 0.8 }}>{btn("★", "item", { background: portrait ? "rgba(255,209,102,0.3)" : "rgba(180,140,40,0.45)", width: pb, height: pb, borderRadius: pb / 2 })}{btn("⤴", "drift", { background: portrait ? "rgba(96,165,250,0.3)" : "rgba(40,80,180,0.45)", width: pb, height: pb, borderRadius: pb / 2, marginBottom: Math.round(pb * 0.35) })}</div>
        </div>
      )}
      {isTouch && portrait && hud && hud.state === "intro" && <div style={{ position: "absolute", left: 0, right: 0, top: VH * scale + 240, textAlign: "center", fontSize: 10, letterSpacing: "0.25em", color: "rgba(255,255,255,0.45)", pointerEvents: "none" }}>⟳ ROTATE FOR THE FULL TRACK · GAS IS AUTOMATIC</div>}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Titillium+Web:ital,wght@0,400;0,600;0,700;0,900;1,700;1,900&display=swap');@keyframes gpIn{0%{opacity:0;transform:translateX(-14px)}100%{opacity:1;transform:none}}@keyframes gpFlash{0%{opacity:0;transform:translateY(-8px)}10%{opacity:1;transform:none}85%{opacity:1}100%{opacity:0}}@keyframes gpBlink{50%{opacity:.35}}@keyframes gpMsg{0%{opacity:0;transform:scale(1.15)}12%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0}}@keyframes gpPop{0%{opacity:0;transform:scale(1.6)}20%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(0.9)}}`}</style>
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

// ── broadcast graphics: timing tower, lap clock, start lights, dashboard, lower thirds ─────────────────────────────
const P1 = "#e10600";   // broadcast red
const PURPLE = "#b138dd", GREEN = "#1ed760", YELLOW = "#ffd400";
function lapFmt(t: number) { if (!t) return "--:--.---"; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, "0")}`; }
function gapFmt(g: number) { return g < 0.05 ? "+0.0" : g < 60 ? `+${g.toFixed(g < 10 ? 3 : 1)}` : "+1 LAP"; }
const paint = (f: string) => FACTION_PAINT[f]?.paint || "#888";

function Broadcast({ hud, S, vw, h, touch, portrait, track, centre }: { hud: Hud; S: number; vw: number; h: number; touch: boolean; portrait: boolean; track: (typeof TRACKS)[number]; centre: [number, number][] | null }) {
  const u = (n: number) => Math.round(n * S * 10) / 10;
  const compact = touch || vw < 760;
  const rows = compact ? hud.tower.filter((r) => r.rank <= 3 || r.you || Math.abs(r.rank - hud.rank) <= 1).slice(0, 5) : hud.tower;
  const prev = useRef(hud.rank); const [delta, setDelta] = useState<{ d: number; id: number } | null>(null);
  useEffect(() => { if (hud.rank !== prev.current && hud.state === "race") { setDelta({ d: prev.current - hud.rank, id: Date.now() }); } prev.current = hud.rank; }, [hud.rank, hud.state]);
  useEffect(() => { if (!delta) return; const t = setTimeout(() => setDelta(null), 1600); return () => clearTimeout(t); }, [delta]);
  const path = React.useMemo(() => centre ? "M" + centre.map(([x, y]) => `${(x / 1024 * 100).toFixed(1)},${(y / 1024 * 100).toFixed(1)}`).join("L") + "Z" : "", [centre]);
  const cup = CUPS.find((c) => c.id === track.cup);
  const flash = hud.lapFlash;
  const flashCol = flash ? (flash.kind === "purple" ? PURPLE : flash.kind === "green" ? GREEN : YELLOW) : "#fff";
  const leds = 15; const lit = Math.round(hud.rpm * leds);
  const po = touch && portrait;   // phone portrait: the panels sit in the space under the picture
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", fontFamily: TV, color: "#fff" }}>
      {/* timing tower */}
      <div style={{ position: "absolute", left: u(8), top: po ? h + 10 : u(8), width: u(compact ? 104 : 128), filter: "drop-shadow(0 2px 6px rgba(0,0,0,.6))" }}>
        <div style={{ display: "flex", alignItems: "stretch", height: u(26), background: "#15151e", borderTopRightRadius: u(6), overflow: "hidden" }}>
          <div style={{ background: P1, padding: `0 ${u(6)}px`, display: "flex", alignItems: "center", fontWeight: 900, fontStyle: "italic", fontSize: u(15) }}>P{hud.rank}</div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", padding: `0 ${u(6)}px`, fontWeight: 700, fontSize: u(9.5), letterSpacing: "0.08em" }}>
            {delta && <span key={delta.id} style={{ marginRight: "auto", marginLeft: u(4), color: delta.d > 0 ? GREEN : P1, fontWeight: 900, animation: "gpFlash 1.6s both" }}>{delta.d > 0 ? "▲" : "▼"}{Math.abs(delta.d)}</span>}
            LAP&nbsp;<span style={{ fontWeight: 900, fontSize: u(12) }}>{hud.lap}</span><span style={{ opacity: 0.6 }}>/{hud.laps}</span>
          </div>
        </div>
        {rows.map((r) => (
          <div key={r.name + r.faction} style={{ display: "flex", alignItems: "center", height: u(compact ? 14 : 15), background: r.you ? "rgba(255,255,255,0.95)" : "rgba(21,21,30,0.86)", color: r.you ? "#15151e" : "#fff", borderTop: "1px solid rgba(255,255,255,0.07)", fontSize: u(9.5), animation: "gpIn .25s both" }}>
            <div style={{ width: u(17), textAlign: "center", fontWeight: 900 }}>{r.rank}</div>
            <div style={{ width: u(3), alignSelf: "stretch", margin: `${u(2.5)}px ${u(4)}px ${u(2.5)}px 0`, background: paint(r.faction), borderRadius: 1 }} />
            <div style={{ fontWeight: 700, letterSpacing: "0.04em", flex: 1 }}>{r.code}</div>
            <div style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, paddingRight: u(5), opacity: r.rank === 1 ? 0.75 : 1, fontSize: u(8.5) }}>{r.finished ? "🏁" : r.pit ? <span style={{ color: P1 }}>OUT</span> : r.rank === 1 ? (compact ? "" : "LEADER") : gapFmt(r.gap)}</div>
          </div>
        ))}
        {hud.fastest && !compact && <div style={{ display: "flex", alignItems: "center", gap: u(5), height: u(16), marginTop: u(3), background: PURPLE, padding: `0 ${u(6)}px`, fontSize: u(8.5), fontWeight: 700 }}>⏱ <span style={{ flex: 1, whiteSpace: "nowrap" }}>{hud.fastest.name.slice(0, 3).toUpperCase()}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{lapFmt(hud.fastest.time)}</span></div>}
      </div>

      {/* lap clock */}
      <div style={{ position: "absolute", right: u(8), top: po ? h + 10 : u(40), minWidth: u(compact ? 96 : 116), background: "rgba(21,21,30,0.86)", borderLeft: `${u(3)}px solid ${P1}`, padding: `${u(4)}px ${u(7)}px`, fontVariantNumeric: "tabular-nums", filter: "drop-shadow(0 2px 6px rgba(0,0,0,.6))" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: u(8) }}><span style={{ fontSize: u(7.5), letterSpacing: "0.12em", opacity: 0.7, fontWeight: 700 }}>LAP</span><span style={{ fontSize: u(13), fontWeight: 900 }}>{lapFmt(hud.curLap)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: u(8.5), marginTop: u(1) }}><span style={{ opacity: 0.6, fontWeight: 700, letterSpacing: "0.1em" }}>LAST</span><span style={{ fontWeight: 700 }}>{lapFmt(hud.lastLap)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: u(8.5) }}><span style={{ opacity: 0.6, fontWeight: 700, letterSpacing: "0.1em" }}>BEST</span><span style={{ fontWeight: 700, color: hud.bestLap && hud.fastest && hud.fastest.you ? PURPLE : hud.bestLap ? GREEN : "#fff" }}>{lapFmt(hud.bestLap)}</span></div>
      </div>

      {/* start lights gantry */}
      {hud.lights >= 0 && (hud.state === "countdown" || hud.state === "intro") && (
        <div style={{ position: "absolute", left: "50%", top: u(compact ? 30 : 14), transform: "translateX(-50%)", display: "flex", gap: u(5), padding: `${u(5)}px ${u(7)}px`, background: "linear-gradient(#22232b,#0c0c10)", borderRadius: u(5), boxShadow: "0 4px 16px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.08)" }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: u(4), padding: u(3), background: "#050507", borderRadius: u(4) }}>
              {[0, 1].map((row) => { const on = row === 1 && hud.lights > i; return <div key={row} style={{ width: u(15), height: u(15), borderRadius: "50%", background: on ? "radial-gradient(circle at 40% 35%, #ffd0c8 0%, #ff2a12 35%, #a30800 75%)" : "radial-gradient(circle at 40% 35%, #3a2a2a, #140c0c)", boxShadow: on ? `0 0 ${u(12)}px ${u(3)}px rgba(255,40,10,.75)` : "none" }} />; })}
            </div>
          ))}
        </div>
      )}

      {/* lap flash */}
      {flash && <div key={flash.id} style={{ position: "absolute", left: "50%", top: u(compact ? 34 : 18), transform: "translateX(-50%)", display: "flex", alignItems: "stretch", height: u(24), animation: "gpFlash 3.4s both", filter: "drop-shadow(0 2px 8px rgba(0,0,0,.6))", whiteSpace: "nowrap" }}>
        <div style={{ background: "#15151e", padding: `0 ${u(8)}px`, display: "flex", alignItems: "center", fontWeight: 900, fontSize: u(10), letterSpacing: "0.1em" }}>LAP {flash.n}</div>
        <div style={{ background: flashCol, color: flash.kind === "yellow" ? "#15151e" : "#fff", padding: `0 ${u(9)}px`, display: "flex", alignItems: "center", fontWeight: 900, fontSize: u(14), fontVariantNumeric: "tabular-nums" }}>{lapFmt(flash.time)}</div>
        {flash.delta !== null && <div style={{ background: "#15151e", padding: `0 ${u(8)}px`, display: "flex", alignItems: "center", fontWeight: 700, fontSize: u(10), color: flash.delta <= 0 ? GREEN : YELLOW, fontVariantNumeric: "tabular-nums" }}>{flash.delta <= 0 ? "−" : "+"}{Math.abs(flash.delta).toFixed(3)}</div>}
        {flash.kind === "purple" && <div style={{ background: PURPLE, padding: `0 ${u(7)}px`, display: "flex", alignItems: "center", fontWeight: 900, fontSize: u(8), letterSpacing: "0.12em" }}>FASTEST LAP</div>}
      </div>}

      {/* messages */}
      {hud.msg && <div style={{ position: "absolute", left: 0, right: 0, top: "36%", textAlign: "center", animation: "gpMsg 2.2s ease-out both" }} key={hud.msg}>
        <div style={{ display: "inline-block", fontSize: u(hud.msg === "LIGHTS OUT" ? 30 : 22), fontWeight: 900, fontStyle: "italic", letterSpacing: "0.04em", textShadow: "0 3px 14px rgba(0,0,0,.8)", color: hud.state === "finished" ? YELLOW : "#fff", borderBottom: `${u(3)}px solid ${P1}`, padding: `0 ${u(10)}px ${u(2)}px` }}>{hud.state === "finished" ? `🏁 ${hud.msg}` : hud.msg}</div>
      </div>}
      {hud.state === "intro" && <div style={{ position: "absolute", left: u(12), bottom: u(touch && !portrait ? 120 : 26), display: "flex", alignItems: "stretch", animation: "gpIn .4s both", filter: "drop-shadow(0 2px 8px rgba(0,0,0,.6))" }}>
        <div style={{ background: P1, width: u(5) }} />
        <div style={{ background: "#15151e", padding: `${u(5)}px ${u(10)}px` }}>
          <div style={{ fontSize: u(8), letterSpacing: "0.22em", opacity: 0.7, fontWeight: 700 }}>ROUND {track.n} · {(cup?.name || "").toUpperCase()}</div>
          <div style={{ fontSize: u(17), fontWeight: 900, fontStyle: "italic", letterSpacing: "0.02em" }}>{track.name.toUpperCase()}</div>
        </div>
      </div>}

      {/* dashboard: rev LEDs, speed, gear, ERS */}
      {hud.state !== "intro" && <div style={{ position: "absolute", left: "50%", ...(po ? { top: h + 150 } : { bottom: u(touch && !portrait ? 8 : 10) }), transform: "translateX(-50%)", width: u(150), background: "linear-gradient(180deg, rgba(18,18,24,.9), rgba(8,8,12,.92))", borderRadius: u(10), padding: `${u(5)}px ${u(8)}px ${u(6)}px`, boxShadow: "0 4px 16px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.08)" }}>
        <div style={{ display: "flex", gap: u(2), justifyContent: "center" }}>{Array.from({ length: leds }, (_, i) => { const col = i < 5 ? GREEN : i < 10 ? P1 : "#3b82f6"; const on = i < lit; return <div key={i} style={{ width: u(6.5), height: u(4), borderRadius: u(2), background: on ? col : "rgba(255,255,255,0.08)", boxShadow: on ? `0 0 ${u(5)}px ${col}` : "none", animation: lit >= leds ? "gpBlink .12s steps(1) infinite" : "none" }} />; })}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: u(3) }}>
          <div style={{ width: u(46), textAlign: "right", fontVariantNumeric: "tabular-nums" }}><div style={{ fontSize: u(19), fontWeight: 900, lineHeight: 1 }}>{hud.kmh}</div><div style={{ fontSize: u(6.5), letterSpacing: "0.18em", opacity: 0.55, fontWeight: 700 }}>KM/H</div></div>
          <div style={{ width: u(28), height: u(28), borderRadius: u(6), background: "#000", border: `1px solid rgba(255,255,255,.18)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: u(20), fontWeight: 900, color: hud.rpm > 0.93 ? "#3b82f6" : "#fff" }}>{hud.gear === 0 ? "N" : hud.gear}</div>
          <div style={{ width: u(46) }}>
            <div style={{ fontSize: u(6.5), letterSpacing: "0.16em", fontWeight: 900, color: hud.drs ? GREEN : "rgba(255,255,255,.45)" }}>{hud.drs ? "OVERTAKE" : "ERS"}</div>
            <div style={{ height: u(5), background: "rgba(255,255,255,0.1)", borderRadius: u(3), marginTop: u(2), overflow: "hidden" }}><div style={{ width: `${Math.round(hud.ers * 100)}%`, height: "100%", background: hud.drs ? GREEN : YELLOW, transition: "width .08s linear" }} /></div>
          </div>
        </div>
      </div>}

      {/* power-up slot */}
      <div style={{ position: "absolute", right: u(po ? 8 : compact && touch ? 8 : 74), ...(po ? { top: h + 150 } : compact && touch ? { top: u(96) } : { bottom: u(10) }), width: u(46), textAlign: "center" }}>
        <div style={{ width: u(40), height: u(40), margin: "0 auto", borderRadius: u(8), background: "rgba(21,21,30,0.86)", border: `${u(2)}px solid ${hud.item ? YELLOW : "rgba(255,255,255,0.25)"}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxShadow: hud.item ? "0 0 14px rgba(255,212,0,0.5)" : "none" }}>
          {(hud.item || hud.roulette) && <div style={{ width: u(32), height: u(32), backgroundImage: "url(/rgp/props.png)", backgroundSize: `${8 * u(32)}px ${4 * u(32)}px`, backgroundPosition: itemBg(hud.roulette ? Math.floor(Date.now() / 90) % 7 : ITEMS[hud.item!].icon, u(32)), imageRendering: "pixelated" }} />}
        </div>
        <div style={{ fontSize: u(7), letterSpacing: "0.12em", marginTop: u(2), color: YELLOW, fontWeight: 900, textShadow: "0 1px 2px #000" }}>{hud.item ? ITEMS[hud.item].name.toUpperCase() : hud.roulette ? "…" : ""}</div>
      </div>

      {/* track map */}
      <div style={{ position: "absolute", ...(po ? { right: u(8), top: h + 72 } : touch ? { left: "50%", top: u(6), marginLeft: -u(30) } : { right: u(8), bottom: u(10) }), width: u(60), height: u(60), borderRadius: u(8), background: "rgba(21,21,30,0.7)", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: u(4) }}>
          {path && <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: "absolute", left: 0, top: 0, display: "block" }}><path d={path} fill="none" stroke="rgba(255,255,255,.85)" strokeWidth={3.2} strokeLinejoin="round" /></svg>}{hud.minimap.map((m, i) => <div key={i} style={{ position: "absolute", left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: m.you ? u(7) : u(5), height: m.you ? u(7) : u(5), transform: "translate(-50%,-50%)", borderRadius: "50%", background: m.you ? YELLOW : paint(m.faction), border: `1px solid ${m.you ? "#000" : "rgba(255,255,255,.7)"}`, zIndex: m.you ? 2 : 1 }} />)}</div>
      </div>
    </div>
  );
}

/** the player's engine: a synthesised turbo-hybrid V6 note that follows revs and gear (quiet, under the music) */
function useEngineNote(hud: Hud | null, muted: boolean) {
  const nodes = useRef<{ ctx: AudioContext; o1: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode } | null>(null);
  const on = !!hud && (hud.state === "race" || hud.state === "countdown") && !muted;
  useEffect(() => () => { const n = nodes.current; if (n) { try { n.o1.stop(); n.o2.stop(); n.ctx.close(); } catch {} nodes.current = null; } }, []);
  useEffect(() => {
    if (!hud) return;
    if (!nodes.current) {
      if (!on) return;
      try {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext; if (!AC) return; const ctx: AudioContext = new AC();
        const o1 = ctx.createOscillator(); o1.type = "sawtooth"; const o2 = ctx.createOscillator(); o2.type = "square";
        const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 6; const g = ctx.createGain(); g.gain.value = 0;
        o1.connect(f); o2.connect(f); f.connect(g); g.connect(ctx.destination); o1.start(); o2.start(); nodes.current = { ctx, o1, o2, f, g };
      } catch { return; }
    }
    const n = nodes.current!; const t = n.ctx.currentTime;
    const rev = hud.gear === 0 ? 0.15 + (hud.state === "countdown" ? 0.25 + 0.1 * Math.sin(t * 9) : 0) : hud.rpm;
    const hz = 95 + rev * 330 + hud.gear * 9;
    n.o1.frequency.setTargetAtTime(hz, t, 0.03); n.o2.frequency.setTargetAtTime(hz * 0.5, t, 0.03); n.f.frequency.setTargetAtTime(500 + rev * 2600, t, 0.05);
    n.g.gain.setTargetAtTime(on ? 0.028 + rev * 0.03 : 0, t, 0.08);
  }, [hud, on]);
}
