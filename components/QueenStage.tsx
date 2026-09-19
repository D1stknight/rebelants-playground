// components/QueenStage.tsx
// The queen as a 2-D paper doll (body + staff pivoting in her fist + fist patch) drawn on a canvas that covers the
// shuffle scene, plus her magic: point at the chosen egg, raise the staff, lightning to the egg, egg cracks and hatches.
// Layers come from tools/queen-sprites (rendered from the real queen GLB; ~250 KB instead of the 20 MB model).
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type Rarity = "none" | "common" | "rare" | "ultra";
export type QueenStageHandle = {
  /** turn toward lane i and point the staff at that egg */
  point: (i: number) => void;
  /** raise the staff, charge, strike the egg with rarity-coloured lightning, crack + hatch it. Resolves when the shell bursts. */
  cast: (i: number, rarity: Rarity) => Promise<void>;
  /** back to idle */
  idle: () => void;
};
type Props = { active?: boolean; /** next/dynamic does not forward refs — the handle is also published here */ apiRef?: React.MutableRefObject<QueenStageHandle | null>; getEggRect: (i: number) => DOMRect | null; onHatch?: (i: number) => void; onCrack?: (i: number, stage: number) => void };

type Layers = { body: HTMLImageElement; staff: HTMLImageElement; fist: HTMLImageElement; meta: any };
let cache: Promise<Layers> | null = null;
function loadLayers(): Promise<Layers> {
  if (cache) return cache;
  const img = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  cache = Promise.all([img("/queen/sprite/body.png"), img("/queen/sprite/staff.png"), img("/queen/sprite/fist.png"), fetch("/queen/sprite/layers.json").then((r) => r.json())]).then(([body, staff, fist, meta]) => ({ body, staff, fist, meta }));
  return cache;
}
const COLORS: Record<Rarity, { bolt: string; glow: string; core: string }> = {
  none: { bolt: "#9ca3af", glow: "rgba(156,163,175,0.5)", core: "#e5e7eb" },
  common: { bolt: "#a78bfa", glow: "rgba(167,139,250,0.7)", core: "#ede9fe" },
  rare: { bolt: "#60a5fa", glow: "rgba(96,165,250,0.8)", core: "#dbeafe" },
  ultra: { bolt: "#fbbf24", glow: "rgba(251,191,36,0.9)", core: "#fff7d6" },
};
const ease = (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const QueenStage = forwardRef<QueenStageHandle, Props>(function QueenStage({ active = false, apiRef, getEggRect, onHatch, onCrack }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const st = useRef({
    L: null as Layers | null, t: 0, raf: 0, last: 0, W: 0, H: 0, dpr: 1,
    // pose (animated toward targets)
    staffA: 0, staffT: 0, lean: 0, leanT: 0, hop: 0, gem: 0, gemT: 0, shake: 0, flash: 0, flashC: "#fff",
    bolts: [] as { pts: { x: number; y: number }[]; life: number; w: number; c: string; core: string }[],
    parts: [] as { x: number; y: number; vx: number; vy: number; life: number; c: string; s: number; g: number }[],
    beam: null as null | { x: number; y: number; life: number; c: string },
    crack: null as null | { i: number; stage: number },
    target: null as null | { x: number; y: number },
  });

  // geometry: queen height relative to the scene, feet on a line above the egg rail
  const geom = () => {
    const s = st.current; const L = s.L!; const k = Math.min(s.H * 0.52, 300) / L.body.height; // queen height ≈ 52% of the scene, ≤ 300 css px
    const bw = L.body.width * k, bh = L.body.height * k; const x = s.W / 2 - bw / 2 + s.lean * 14, y = s.H * 0.655 - bh - s.hop;
    const m = L.meta; const sc = m.scale as number; const bx = m.body.box[0], by = m.body.box[1];
    const pivot = { x: x + (m.pivot[0] - bx) * sc * k, y: y + (m.pivot[1] - by) * sc * k };
    const gem0 = { x: x + (m.gem[0] - bx) * sc * k, y: y + (m.gem[1] - by) * sc * k };
    return { k, x, y, bw, bh, pivot, gem0, staffOff: { x: (m.staff.box[0] - bx) * sc * k, y: (m.staff.box[1] - by) * sc * k }, fistOff: { x: (m.fist.box[0] - bx) * sc * k, y: (m.fist.box[1] - by) * sc * k } };
  };
  const gemPos = () => { const g = geom(); const a = st.current.staffA; const dx = g.gem0.x - g.pivot.x, dy = g.gem0.y - g.pivot.y; return { x: g.pivot.x + dx * Math.cos(a) - dy * Math.sin(a), y: g.pivot.y + dx * Math.sin(a) + dy * Math.cos(a) }; };
  const sceneRect = () => canvasRef.current!.getBoundingClientRect();
  const eggCenter = (i: number) => { const r = getEggRect(i); if (!r) return null; const sr = sceneRect(); return { x: r.left - sr.left + r.width / 2, y: r.top - sr.top + r.height * 0.55, w: r.width, h: r.height }; };
  const angleTo = (p: { x: number; y: number }) => { const g = geom(); const base = Math.atan2(g.gem0.y - g.pivot.y, g.gem0.x - g.pivot.x); let a = Math.atan2(p.y - g.pivot.y, p.x - g.pivot.x) - base; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return Math.max(-2.4, Math.min(2.4, a)); };

  const burst = (x: number, y: number, c: string, n: number, sp = 3, g = 6) => { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = (0.4 + Math.random()) * sp * 60; st.current.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.5 + Math.random() * 0.6, c, s: 2 + Math.random() * 3, g: g * 60 }); } };
  const bolt = (a: { x: number; y: number }, b: { x: number; y: number }, c: { bolt: string; core: string }, w: number, branch = true) => {
    const pts = [a]; const n = 9 + ((Math.random() * 4) | 0); const dx = b.x - a.x, dy = b.y - a.y; const len = Math.hypot(dx, dy); const nx = -dy / len, ny = dx / len;
    for (let i = 1; i < n; i++) { const t = i / n; const off = (Math.random() - 0.5) * len * 0.14 * Math.sin(t * Math.PI); pts.push({ x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off }); }
    pts.push(b); st.current.bolts.push({ pts, life: 0.14 + Math.random() * 0.1, w, c: c.bolt, core: c.core });
    if (branch) for (let k = 0; k < 2; k++) { const i = 2 + ((Math.random() * (n - 4)) | 0); const p = pts[i]; const e = { x: p.x + (Math.random() - 0.5) * len * 0.35, y: p.y + Math.random() * len * 0.3 }; const bp = [p]; for (let j = 1; j < 4; j++) bp.push({ x: p.x + (e.x - p.x) * (j / 4) + (Math.random() - 0.5) * 12, y: p.y + (e.y - p.y) * (j / 4) + (Math.random() - 0.5) * 12 }); st.current.bolts.push({ pts: bp, life: 0.1, w: w * 0.5, c: c.bolt, core: c.core }); }
  };

  const api: QueenStageHandle = ({
    point(i) { const s = st.current; if (!s.L) return; const e = eggCenter(i); if (!e) return; s.target = e; s.staffT = angleTo(e); s.leanT = e.x < s.W / 2 ? -1 : 1; s.gemT = 0.5; },
    async cast(i, rarity) {
      const s = st.current; if (!s.L) { await wait(600); onCrack?.(i, 3); onHatch?.(i); return; }
      const e = eggCenter(i); if (!e) { onHatch?.(i); return; } s.target = e; const col = COLORS[rarity];
      // 1. point
      s.staffT = angleTo(e); s.leanT = e.x < s.W / 2 ? -1 : 1; s.gemT = 0.6; await wait(450);
      if (rarity === "none") {
        // fizzle: a puff of grey sparks, staff droops, egg wobbles and cracks open on nothing
        s.gemT = 1; await wait(250); const g = gemPos(); burst(g.x, g.y, "#cbd5e1", 18, 2, 3); s.gemT = 0; s.staffT = 0.6; s.leanT = 0; await wait(350);
        for (let k = 1; k <= 3; k++) { s.crack = { i, stage: k }; onCrack?.(i, k); s.shake = 0.5; await wait(220); }
        burst(e.x, e.y, "#d6c9a8", 16, 2.5, 5); s.crack = null; onHatch?.(i); await wait(350); s.staffT = 0; return;
      }
      // 2. raise + charge
      s.staffT = s.leanT < 0 ? -2.2 : -1.9; s.hop = 10; s.gemT = 1; const power = rarity === "ultra" ? 3 : rarity === "rare" ? 2 : 1;
      for (let k = 0; k < 10; k++) { const g = gemPos(); const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 50; s.parts.push({ x: g.x + Math.cos(a) * r, y: g.y + Math.sin(a) * r, vx: -Math.cos(a) * r * 2.2, vy: -Math.sin(a) * r * 2.2, life: 0.45, c: col.bolt, s: 2 + power, g: 0 }); await wait(45); }
      s.hop = 0; await wait(120);
      // 3. strike (flickering bolts from the gem to the egg)
      const strikes = 3 + power * 2;
      for (let k = 0; k < strikes; k++) {
        const g = gemPos(); bolt(g, { x: e.x, y: e.y - e.h * 0.25 }, col, 2 + power, true); if (power >= 2) bolt({ x: g.x + (Math.random() - 0.5) * 20, y: g.y }, { x: e.x + (Math.random() - 0.5) * 16, y: e.y - e.h * 0.2 }, col, 1.5, false);
        s.flash = 0.35 + power * 0.15; s.flashC = col.glow; s.shake = 0.6 + power * 0.3; burst(e.x, e.y - e.h * 0.2, col.bolt, 6 + power * 4, 3, 4);
        const stage = Math.min(3, 1 + Math.floor((k / strikes) * 3)); if (!s.crack || s.crack.stage !== stage) { s.crack = { i, stage }; onCrack?.(i, stage); }
        await wait(110 + Math.random() * 60);
      }
      // 4. hatch: shell bursts, light column in the rarity colour
      s.crack = null; burst(e.x, e.y, "#f3e2b0", 28, 4, 6); burst(e.x, e.y, col.bolt, 30 + power * 12, 4 + power, 2); s.beam = { x: e.x, y: e.y, life: 1.2 + power * 0.3, c: col.bolt }; s.flash = 0.6 + power * 0.15; s.flashC = col.glow; onHatch?.(i);
      if (rarity === "ultra") { for (let k = 0; k < 40; k++) s.parts.push({ x: Math.random() * s.W, y: -10, vx: (Math.random() - 0.5) * 30, vy: 60 + Math.random() * 120, life: 1.6 + Math.random(), c: k % 2 ? "#fbbf24" : "#fff3c4", s: 2 + Math.random() * 3, g: 40 }); }
      await wait(950); s.staffT = 0; s.leanT = 0; s.gemT = 0.2;
    },
    idle() { const s = st.current; s.staffT = 0; s.leanT = 0; s.gemT = 0; s.crack = null; s.target = null; },
  });
  useImperativeHandle(ref, () => api); useEffect(() => { if (apiRef) apiRef.current = api; return () => { if (apiRef) apiRef.current = null; }; });

  useEffect(() => {
    let alive = true; loadLayers().then((L) => { if (alive) st.current.L = L; }).catch(() => {});
    const cv = canvasRef.current!; const ctx = cv.getContext("2d")!;
    const fit = () => { const r = cv.getBoundingClientRect(); const s = st.current; s.dpr = Math.min(2, window.devicePixelRatio || 1); s.W = r.width; s.H = r.height; cv.width = Math.round(r.width * s.dpr); cv.height = Math.round(r.height * s.dpr); };
    fit(); window.addEventListener("resize", fit);
    const loop = (now: number) => {
      if (!alive) return; const s = st.current; const dt = Math.min(0.05, (now - (s.last || now)) / 1000); s.last = now; s.t += dt;
      // pose easing
      s.staffA += (s.staffT - s.staffA) * Math.min(1, dt * 9); s.lean += (s.leanT - s.lean) * Math.min(1, dt * 6); s.gem += (s.gemT - s.gem) * Math.min(1, dt * 8);
      if (s.shake > 0) s.shake = Math.max(0, s.shake - dt * 3); if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 2.4);
      for (const p of s.parts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; } s.parts = s.parts.filter((p) => p.life > 0);
      for (const b of s.bolts) b.life -= dt; s.bolts = s.bolts.filter((b) => b.life > 0);
      if (s.beam) { s.beam.life -= dt; if (s.beam.life <= 0) s.beam = null; }
      // draw
      const W = s.W, H = s.H; ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      if (s.L) {
        const g = geom(); const bob = Math.sin(s.t * (active ? 6 : 2)) * (active ? 3 : 2);
        const sx = (Math.random() - 0.5) * s.shake * 6, sy = (Math.random() - 0.5) * s.shake * 4;
        ctx.save(); ctx.translate(g.x + g.bw / 2 + sx, g.y + g.bh + bob + sy); ctx.rotate(s.lean * 0.06); ctx.translate(-(g.x + g.bw / 2), -(g.y + g.bh));
        // aura behind her while shuffling / charging
        const au = (active ? 0.25 : 0.12) + s.gem * 0.3; const ag = ctx.createRadialGradient(g.x + g.bw / 2, g.y + g.bh * 0.5, 10, g.x + g.bw / 2, g.y + g.bh * 0.5, g.bh * 0.7); ag.addColorStop(0, `rgba(167,139,250,${au})`); ag.addColorStop(1, "rgba(109,40,217,0)"); ctx.fillStyle = ag; ctx.fillRect(g.x - g.bw, g.y - 40, g.bw * 3, g.bh + 80);
        // ground shadow
        ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.ellipse(g.x + g.bw / 2, g.y + g.bh - 2 - bob, g.bw * 0.34, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.drawImage(s.L.body, g.x, g.y, g.bw, g.bh);
        // staff rotates in her fist
        ctx.save(); ctx.translate(g.pivot.x, g.pivot.y); ctx.rotate(s.staffA); ctx.translate(-g.pivot.x, -g.pivot.y);
        ctx.drawImage(s.L.staff, g.x + g.staffOff.x, g.y + g.staffOff.y, s.L.staff.width * g.k, s.L.staff.height * g.k); ctx.restore();
        ctx.drawImage(s.L.fist, g.x + g.fistOff.x, g.y + g.fistOff.y, s.L.fist.width * g.k, s.L.fist.height * g.k);
        ctx.restore();
        // gem glow (follows the staff tip)
        if (s.gem > 0.02) { const gp = gemPos(); gp.y += bob; const rr = 14 + s.gem * 26 + Math.sin(s.t * 14) * 3; const gg = ctx.createRadialGradient(gp.x, gp.y, 1, gp.x, gp.y, rr); gg.addColorStop(0, `rgba(255,120,150,${0.9 * s.gem})`); gg.addColorStop(0.4, `rgba(255,60,90,${0.45 * s.gem})`); gg.addColorStop(1, "rgba(255,60,90,0)"); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(gp.x, gp.y, rr, 0, Math.PI * 2); ctx.fill(); }
      }
      // light beam on the hatched egg
      if (s.beam) { const b = s.beam; const a = Math.min(1, b.life) * 0.9; const lg = ctx.createLinearGradient(0, 0, 0, b.y); lg.addColorStop(0, `${b.c}00`); lg.addColorStop(1, b.c + Math.round(a * 140).toString(16).padStart(2, "0")); ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(b.x - 10, b.y); ctx.lineTo(b.x - 46, 0); ctx.lineTo(b.x + 46, 0); ctx.lineTo(b.x + 10, b.y); ctx.closePath(); ctx.fill(); }
      // bolts
      for (const b of s.bolts) { ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.shadowColor = b.c; ctx.shadowBlur = 18; ctx.strokeStyle = b.c; ctx.lineWidth = b.w * 2.2; ctx.globalAlpha = Math.min(1, b.life * 8); ctx.beginPath(); b.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); ctx.shadowBlur = 0; ctx.strokeStyle = b.core; ctx.lineWidth = b.w * 0.8; ctx.stroke(); ctx.restore(); }
      // cracks over the egg (dark zig-zags that grow with the stage)
      if (s.crack) { const e = eggCenter(s.crack.i); if (e) { ctx.save(); ctx.strokeStyle = "rgba(40,20,10,0.85)"; ctx.lineWidth = 2; ctx.lineCap = "round"; const w = e.w * 0.32, h = e.h * 0.42; const seg = (pts: number[][]) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(e.x + p[0] * w, e.y - e.h * 0.05 + p[1] * h) : ctx.moveTo(e.x + p[0] * w, e.y - e.h * 0.05 + p[1] * h))); ctx.stroke(); };
        seg([[-0.1, -0.9], [0.15, -0.5], [-0.05, -0.2], [0.2, 0.15]]); if (s.crack.stage >= 2) { seg([[0.15, -0.5], [0.55, -0.35], [0.8, -0.05]]); seg([[-0.05, -0.2], [-0.5, -0.1], [-0.75, 0.25]]); } if (s.crack.stage >= 3) { seg([[0.2, 0.15], [0.05, 0.55], [0.3, 0.85]]); seg([[-0.5, -0.1], [-0.35, 0.4], [-0.6, 0.7]]); ctx.strokeStyle = "rgba(255,240,180,0.7)"; ctx.lineWidth = 1; seg([[-0.1, -0.9], [0.15, -0.5], [-0.05, -0.2], [0.2, 0.15], [0.05, 0.55]]); } ctx.restore(); } }
      // particles
      for (const p of s.parts) { ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2)); ctx.fillStyle = p.c; ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); } ctx.globalAlpha = 1;
      if (s.flash > 0) { ctx.fillStyle = s.flashC; ctx.globalAlpha = s.flash * 0.5; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
      s.raf = requestAnimationFrame(loop);
    };
    st.current.raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(st.current.raf); window.removeEventListener("resize", fit); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return <canvas ref={canvasRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 7 }} />;
});
export default QueenStage;
