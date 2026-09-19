// components/QueenStage.tsx
// The queen as a 2-D paper doll on a canvas over the shuffle scene: body · arm (swings from the shoulder) · staff (held in
// the fist, small wrist tilt) — rendered from the real queen GLB by tools/queen-sprites (~260 KB vs the 20 MB model).
// She faces the chosen lane (mirrored when the egg is on her other side), points, raises the staff, strikes the egg with
// rarity-coloured lightning; the egg cracks with light leaking out, then bursts. Sounds are requested through onSfx.
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type Rarity = "none" | "common" | "rare" | "ultra";
export type StageSfx = "charge" | "bolt" | "crack1" | "crack2" | "crack3" | "hatch" | "fizzle";
export type QueenStageHandle = { point: (i: number) => void; cast: (i: number, rarity: Rarity) => Promise<void>; idle: () => void };
type Props = { active?: boolean; apiRef?: React.MutableRefObject<QueenStageHandle | null>; getEggRect: (i: number) => DOMRect | null; onHatch?: (i: number) => void; onCrack?: (i: number, stage: number) => void; onSfx?: (n: StageSfx) => void };

type Layers = { body: HTMLImageElement; staff: HTMLImageElement; arm: HTMLImageElement; faces: Record<string, HTMLImageElement>; meta: any };
let cache: Promise<Layers> | null = null;
function loadLayers(): Promise<Layers> {
  if (cache) return cache;
  const img = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  cache = fetch("/queen/sprite/layers.json").then((r) => r.json()).then(async (meta) => {
    const names: string[] = meta?.face?.names || [];
    const [body, staff, arm, ...faceImgs] = await Promise.all([img("/queen/sprite/body.png"), img("/queen/sprite/staff.png"), img("/queen/sprite/arm.png"), ...names.map((n) => img(`/queen/sprite/face_${n}.png`).catch(() => null as any))]);
    const faces: Record<string, HTMLImageElement> = {}; names.forEach((n, i) => { if (faceImgs[i]) faces[n] = faceImgs[i]; });
    return { body, staff, arm, faces, meta };
  });
  return cache;
}
const COLORS: Record<Rarity, { bolt: string; glow: string; core: string; rgb: string }> = {
  none: { bolt: "#9ca3af", glow: "rgba(156,163,175,0.5)", core: "#e5e7eb", rgb: "156,163,175" },
  common: { bolt: "#a78bfa", glow: "rgba(167,139,250,0.7)", core: "#ede9fe", rgb: "167,139,250" },
  rare: { bolt: "#60a5fa", glow: "rgba(96,165,250,0.8)", core: "#dbeafe", rgb: "96,165,250" },
  ultra: { bolt: "#fbbf24", glow: "rgba(251,191,36,0.9)", core: "#fff7d6", rgb: "251,191,36" },
};
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const D = Math.PI / 180;
// poses (angles in the un-mirrored frame: her staff hand is on the viewer's left). arm = rotation about the shoulder,
// staff = world angle of the staff (gem direction), −90° = straight up
const POSE = { rest: { arm: 0, staff: -90 }, point: { arm: 34, staff: -140 }, raise: { arm: 104, staff: -132 }, droop: { arm: 8, staff: -128 } };

const QueenStage = forwardRef<QueenStageHandle, Props>(function QueenStage({ active = false, apiRef, getEggRect, onHatch, onCrack, onSfx }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const st = useRef({
    L: null as Layers | null, t: 0, raf: 0, last: 0, W: 0, H: 0, dpr: 1,
    arm: 0, armT: 0, staff: -90, staffT: -90, face: 1, faceT: 1, lean: 0, leanT: 0, hop: 0, gem: 0, gemT: 0, shake: 0, flash: 0, flashC: "#fff",
    bolts: [] as { pts: { x: number; y: number }[]; life: number; w: number; c: string; core: string }[],
    parts: [] as { x: number; y: number; vx: number; vy: number; life: number; c: string; s: number; g: number }[],
    beam: null as null | { x: number; y: number; life: number; c: string },
    crack: null as null | { i: number; stage: number; rgb: string; t: number },
    eggGlow: 0, eggGlowC: "167,139,250",
    expr: "idle", exprHold: 0, blinkAt: 2.5, blinkT: 0,
  });
  const setFace = (n: string, hold = 0) => { const s = st.current; s.expr = n; s.exprHold = hold; };

  // ── geometry (css px). face = −1 mirrors her around her own centre line so the staff hand is on the egg's side
  const geom = () => {
    const s = st.current; const L = s.L!; const m = L.meta; const k = Math.min(s.H * 0.54, 310) / L.body.height; const sc = m.scale as number;
    const bw = L.body.width * k, bh = L.body.height * k; const cx = s.W / 2 + s.lean * 10; const x = cx - bw / 2, y = s.H * 0.655 - bh - s.hop;
    const bx = m.body.box[0], by = m.body.box[1]; const P = (p: number[]) => ({ x: x + (p[0] - bx) * sc * k, y: y + (p[1] - by) * sc * k });
    const shoulder = P(m.shoulder), fist0 = P(m.pivot), gem0 = P(m.gem);
    const rot = (p: { x: number; y: number }, c: { x: number; y: number }, a: number) => ({ x: c.x + (p.x - c.x) * Math.cos(a) - (p.y - c.y) * Math.sin(a), y: c.y + (p.x - c.x) * Math.sin(a) + (p.y - c.y) * Math.cos(a) });
    const fist = rot(fist0, shoulder, s.arm * D);                          // the fist rides on the arm
    const staffBase = Math.atan2(gem0.y - fist0.y, gem0.x - fist0.x);      // staff direction at rest (≈ straight up)
    const staffRot = s.staff * D - staffBase;                              // rotation to apply to the staff layer about the fist
    const gem = rot({ x: fist.x + (gem0.x - fist0.x), y: fist.y + (gem0.y - fist0.y) }, fist, staffRot);
    const mirror = (p: { x: number; y: number }) => (s.face < 0 ? { x: 2 * cx - p.x, y: p.y } : p);
    return { k, sc, x, y, bw, bh, cx, shoulder, fist0, fist, gem0, gem, staffRot, gemWorld: mirror(gem), armOff: { x: (m.arm.box[0] - bx) * sc * k, y: (m.arm.box[1] - by) * sc * k }, staffOff: { x: (m.staff.box[0] - bx) * sc * k, y: (m.staff.box[1] - by) * sc * k } };
  };
  const sceneRect = () => canvasRef.current!.getBoundingClientRect();
  const eggCenter = (i: number) => { const r = getEggRect(i); if (!r) return null; const sr = sceneRect(); return { x: r.left - sr.left + r.width / 2, y: r.top - sr.top + r.height * 0.55, w: r.width, h: r.height }; };
  /** aim: mirror toward the egg's side, arm out, staff pointing at the egg (in the un-mirrored frame) */
  const aim = (e: { x: number; y: number }) => {
    const s = st.current; s.faceT = e.x < s.W / 2 ? 1 : -1; s.leanT = s.faceT < 0 ? 1 : -1;
    const ex = s.faceT < 0 ? 2 * (s.W / 2) - e.x : e.x;                    // egg position in the un-mirrored frame
    const g0 = { ...geom() }; const fistApprox = g0.fist0; const a = Math.atan2(e.y - fistApprox.y, ex - fistApprox.x) / D; // −180..180, down-left ≈ 135
    s.armT = POSE.point.arm; s.staffT = Math.max(-265, Math.min(-160, a > 0 ? a - 360 : a));   // staff held out toward the egg, gem leading (−180 = level)   // staff tip toward the egg (−90 = up, −225 = down-left), never through her body
  };

  const burst = (x: number, y: number, c: string, n: number, sp = 3, g = 6, size = 3) => { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = (0.4 + Math.random()) * sp * 60; st.current.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.5 + Math.random() * 0.6, c, s: 2 + Math.random() * size, g: g * 60 }); } };
  const bolt = (a: { x: number; y: number }, b: { x: number; y: number }, c: { bolt: string; core: string }, w: number, branch = true) => {
    const pts = [a]; const n = 9 + ((Math.random() * 4) | 0); const dx = b.x - a.x, dy = b.y - a.y; const len = Math.hypot(dx, dy); const nx = -dy / len, ny = dx / len;
    const side = (b.x < st.current.W / 2 ? -1 : 1) * (nx < 0 ? 1 : -1) * -1;   // bow away from the queen (toward the scene edge)
    for (let i = 1; i < n; i++) { const t = i / n; const off = ((Math.random() - 0.5) * 0.14 + side * 0.22) * len * Math.sin(t * Math.PI); pts.push({ x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off }); }
    pts.push(b); st.current.bolts.push({ pts, life: 0.14 + Math.random() * 0.1, w, c: c.bolt, core: c.core });
    if (branch) for (let k = 0; k < 2; k++) { const i = 2 + ((Math.random() * (n - 4)) | 0); const p = pts[i]; const e = { x: p.x + (Math.random() - 0.5) * len * 0.35, y: p.y + Math.random() * len * 0.3 }; const bp = [p]; for (let j = 1; j < 4; j++) bp.push({ x: p.x + (e.x - p.x) * (j / 4) + (Math.random() - 0.5) * 12, y: p.y + (e.y - p.y) * (j / 4) + (Math.random() - 0.5) * 12 }); st.current.bolts.push({ pts: bp, life: 0.1, w: w * 0.5, c: c.bolt, core: c.core }); }
  };
  const setCrack = (i: number, stage: number, rgb: string) => { const s = st.current; s.crack = { i, stage, rgb, t: 0 }; s.eggGlow = 0.5 + stage * 0.25; s.eggGlowC = rgb; onCrack?.(i, stage); onSfx?.(("crack" + stage) as StageSfx); };

  const api: QueenStageHandle = ({
    point(i) { const s = st.current; if (!s.L) return; const e = eggCenter(i); if (!e) return; aim(e); s.gemT = 0.5; setFace("focus"); },
    async cast(i, rarity) {
      const s = st.current; if (!s.L) { await wait(600); onCrack?.(i, 3); onHatch?.(i); return; }
      const e = eggCenter(i); if (!e) { onHatch?.(i); return; } const col = COLORS[rarity];
      // 1. point at the egg
      aim(e); s.gemT = 0.6; setFace("focus"); await wait(500);
      if (rarity === "none") {
        onSfx?.("charge"); s.gemT = 1; await wait(300); const g = geom().gemWorld; burst(g.x, g.y, "#cbd5e1", 20, 2, 3); onSfx?.("fizzle"); s.gemT = 0; s.armT = POSE.droop.arm; s.staffT = POSE.droop.staff; setFace("shock"); await wait(350); setFace("sad");
        for (let k = 1; k <= 3; k++) { setCrack(i, k, col.rgb); s.shake = 0.5; await wait(260); }
        burst(e.x, e.y, "#d6c9a8", 18, 2.5, 5); s.crack = null; s.eggGlow = 0; onHatch?.(i); await wait(400); s.armT = 0; s.staffT = -90; s.leanT = 0; setFace("sad", 2.5); return;
      }
      // 2. raise the staff and charge the gem
      const power = rarity === "ultra" ? 3 : rarity === "rare" ? 2 : 1;
      s.armT = POSE.raise.arm; s.staffT = POSE.raise.staff; s.hop = 10; s.gemT = 1; onSfx?.("charge"); setFace("intense");
      for (let k = 0; k < 12; k++) { const g = geom().gemWorld; const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 60; s.parts.push({ x: g.x + Math.cos(a) * r, y: g.y + Math.sin(a) * r, vx: -Math.cos(a) * r * 2.2, vy: -Math.sin(a) * r * 2.2, life: 0.45, c: col.bolt, s: 2 + power, g: 0 }); await wait(45); }
      s.hop = 0; await wait(100);
      // 3. strikes — each one deepens the cracks, light leaks out
      const strikes = 3 + power * 2; let stage = 0; setFace("shock");
      for (let k = 0; k < strikes; k++) {
        const g = geom().gemWorld; bolt(g, { x: e.x, y: e.y - e.h * 0.25 }, col, 2 + power, true); if (power >= 2) bolt({ x: g.x + (Math.random() - 0.5) * 20, y: g.y }, { x: e.x + (Math.random() - 0.5) * 16, y: e.y - e.h * 0.2 }, col, 1.5, false);
        if (k === 0 || k === strikes - 1 || Math.random() < 0.5) onSfx?.("bolt");
        s.flash = 0.35 + power * 0.15; s.flashC = col.glow; s.shake = 0.6 + power * 0.3; burst(e.x, e.y - e.h * 0.2, col.bolt, 8 + power * 4, 3, 4);
        const ns = Math.min(3, 1 + Math.floor((k / strikes) * 3)); if (ns !== stage) { stage = ns; setCrack(i, ns, col.rgb); } else if (s.crack) s.crack.t = 0;
        await wait(120 + Math.random() * 60);
      }
      await wait(120);
      // 4. hatch: shell bursts, light column in the rarity colour
      s.crack = null; s.eggGlow = 0; onSfx?.("hatch"); setFace(rarity === "common" ? "smirk" : "happy", 3); burst(e.x, e.y, "#f3e2b0", 34, 4.5, 6, 4); burst(e.x, e.y, col.bolt, 36 + power * 14, 4 + power, 2); s.beam = { x: e.x, y: e.y, life: 1.3 + power * 0.3, c: col.bolt }; s.flash = 0.6 + power * 0.15; s.flashC = col.glow; onHatch?.(i);
      if (rarity === "ultra") { for (let k = 0; k < 48; k++) s.parts.push({ x: Math.random() * s.W, y: -10, vx: (Math.random() - 0.5) * 30, vy: 60 + Math.random() * 120, life: 1.6 + Math.random(), c: k % 2 ? "#fbbf24" : "#fff3c4", s: 2 + Math.random() * 3, g: 40 }); }
      await wait(1000); s.armT = 0; s.staffT = -90; s.leanT = 0; s.gemT = 0.2;
    },
    idle() { const s = st.current; s.armT = 0; s.staffT = -90; s.leanT = 0; s.faceT = 1; s.gemT = 0; s.crack = null; s.eggGlow = 0; setFace("idle"); },
  });
  useImperativeHandle(ref, () => api); useEffect(() => { if (apiRef) apiRef.current = api; return () => { if (apiRef) apiRef.current = null; }; });

  useEffect(() => {
    let alive = true; loadLayers().then((L) => { if (alive) st.current.L = L; }).catch(() => {});
    const cv = canvasRef.current!; const ctx = cv.getContext("2d")!;
    const fit = () => { const r = cv.getBoundingClientRect(); const s = st.current; s.dpr = Math.min(2, window.devicePixelRatio || 1); s.W = r.width; s.H = r.height; cv.width = Math.round(r.width * s.dpr); cv.height = Math.round(r.height * s.dpr); };
    fit(); window.addEventListener("resize", fit);
    const loop = (now: number) => {
      if (!alive) return; const s = st.current; const dt = Math.min(0.05, (now - (s.last || now)) / 1000); s.last = now; s.t += dt;
      // pose easing (arm slower than the wrist; the flip is a quick snap)
      s.arm += (s.armT - s.arm) * Math.min(1, dt * 7); s.staff += (s.staffT - s.staff) * Math.min(1, dt * 9); s.lean += (s.leanT - s.lean) * Math.min(1, dt * 6); s.gem += (s.gemT - s.gem) * Math.min(1, dt * 8);
      s.face += (s.faceT - s.face) * Math.min(1, dt * 12); if (Math.abs(s.face) < 0.08) s.face = s.faceT * 0.08;
      if (s.exprHold > 0) { s.exprHold -= dt; if (s.exprHold <= 0) s.expr = "idle"; }
      if (s.expr === "idle") { s.blinkAt -= dt; if (s.blinkAt <= 0) { s.blinkT = 0.13; s.blinkAt = 2.2 + Math.random() * 3; } } if (s.blinkT > 0) s.blinkT -= dt;
      if (s.shake > 0) s.shake = Math.max(0, s.shake - dt * 3); if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 2.4); if (s.crack) s.crack.t += dt;
      for (const p of s.parts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; } s.parts = s.parts.filter((p) => p.life > 0);
      for (const b of s.bolts) b.life -= dt; s.bolts = s.bolts.filter((b) => b.life > 0);
      if (s.beam) { s.beam.life -= dt; if (s.beam.life <= 0) s.beam = null; }
      const W = s.W, H = s.H; ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      // egg glow under the cracking egg (drawn first so the DOM egg's cracks read over it… the canvas is above the egg, so keep it soft)
      if (s.crack && s.eggGlow > 0) { const e = eggCenter(s.crack.i); if (e) { const pulse = 0.75 + 0.25 * Math.sin(s.t * 18); const rr = e.w * (0.55 + s.eggGlow * 0.5) * pulse; const gg = ctx.createRadialGradient(e.x, e.y, 4, e.x, e.y, rr); gg.addColorStop(0, `rgba(${s.eggGlowC},${0.55 * s.eggGlow})`); gg.addColorStop(0.5, `rgba(${s.eggGlowC},${0.22 * s.eggGlow})`); gg.addColorStop(1, `rgba(${s.eggGlowC},0)`); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(e.x, e.y, rr, 0, Math.PI * 2); ctx.fill(); } }
      if (s.L) {
        const g = geom(); const bob = Math.sin(s.t * (active ? 6 : 2)) * (active ? 3 : 2);
        const sx = (Math.random() - 0.5) * s.shake * 6, sy = (Math.random() - 0.5) * s.shake * 4;
        // aura + ground shadow
        const au = (active ? 0.25 : 0.12) + s.gem * 0.3; const ag = ctx.createRadialGradient(g.cx, g.y + g.bh * 0.5, 10, g.cx, g.y + g.bh * 0.5, g.bh * 0.7); ag.addColorStop(0, `rgba(167,139,250,${au})`); ag.addColorStop(1, "rgba(109,40,217,0)"); ctx.fillStyle = ag; ctx.fillRect(g.x - g.bw, g.y - 40, g.bw * 3, g.bh + 80);
        ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.ellipse(g.cx, g.y + g.bh - 2 + s.hop, g.bw * 0.34, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        ctx.translate(g.cx + sx, g.y + g.bh + bob + sy); ctx.rotate(s.lean * 0.05); ctx.scale(s.face < 0 ? -1 : 1, 1); ctx.translate(-g.cx, -(g.y + g.bh));   // lean + mirror about her centre line
        ctx.drawImage(s.L.body, g.x, g.y, g.bw, g.bh);
        // expression layer over her face
        { const fb = s.L.meta?.face?.box; const fn = s.expr === "idle" && s.blinkT > 0 ? "blink" : s.expr; const fi = fb && s.L.faces[fn] && fn !== "idle" ? s.L.faces[fn] : null; if (fi && fb) { const bx = s.L.meta.body.box[0], by = s.L.meta.body.box[1]; ctx.drawImage(fi, g.x + (fb[0] - bx) * g.sc * g.k, g.y + (fb[1] - by) * g.sc * g.k, fi.width * g.k, fi.height * g.k); } }
        // arm swings from the shoulder; the staff is held in the fist with its own wrist angle
        ctx.save(); ctx.translate(g.shoulder.x, g.shoulder.y); ctx.rotate(s.arm * D); ctx.translate(-g.shoulder.x, -g.shoulder.y);
        ctx.save(); ctx.translate(g.fist0.x, g.fist0.y); ctx.rotate(g.staffRot - s.arm * D); ctx.translate(-g.fist0.x, -g.fist0.y);
        ctx.drawImage(s.L.staff, g.x + g.staffOff.x, g.y + g.staffOff.y, s.L.staff.width * g.k, s.L.staff.height * g.k); ctx.restore();
        ctx.drawImage(s.L.arm, g.x + g.armOff.x, g.y + g.armOff.y, s.L.arm.width * g.k, s.L.arm.height * g.k);
        ctx.restore(); ctx.restore();
        // gem glow follows the staff tip
        if (s.gem > 0.02) { const gp = g.gemWorld; gp.y += bob; const rr = 14 + s.gem * 28 + Math.sin(s.t * 14) * 3; const gg = ctx.createRadialGradient(gp.x, gp.y, 1, gp.x, gp.y, rr); gg.addColorStop(0, `rgba(255,120,150,${0.9 * s.gem})`); gg.addColorStop(0.4, `rgba(255,60,90,${0.45 * s.gem})`); gg.addColorStop(1, "rgba(255,60,90,0)"); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(gp.x, gp.y, rr, 0, Math.PI * 2); ctx.fill(); }
      }
      if (s.beam) { const b = s.beam; const a = Math.min(1, b.life) * 0.9; const lg = ctx.createLinearGradient(0, 0, 0, b.y); lg.addColorStop(0, `${b.c}00`); lg.addColorStop(1, b.c + Math.round(a * 150).toString(16).padStart(2, "0")); ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(b.x - 12, b.y); ctx.lineTo(b.x - 52, 0); ctx.lineTo(b.x + 52, 0); ctx.lineTo(b.x + 12, b.y); ctx.closePath(); ctx.fill(); }
      for (const b of s.bolts) { ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.shadowColor = b.c; ctx.shadowBlur = 22; ctx.strokeStyle = b.c; ctx.lineWidth = b.w * 2.4; ctx.globalAlpha = Math.min(1, b.life * 8); ctx.beginPath(); b.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); ctx.shadowBlur = 0; ctx.strokeStyle = b.core; ctx.lineWidth = b.w * 0.8; ctx.stroke(); ctx.restore(); }
      // cracks: light of the rarity colour leaking through, dark fracture lines on top, growing with the stage; each hit re-flares them
      if (s.crack) { const e = eggCenter(s.crack.i); if (e) {
        const c = s.crack; const w = e.w * 0.34, h = e.h * 0.44; const flare = Math.max(0, 1 - c.t * 3); const cy = e.y - e.h * 0.05;
        const seg = (pts: number[][]) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(e.x + p[0] * w, cy + p[1] * h) : ctx.moveTo(e.x + p[0] * w, cy + p[1] * h))); ctx.stroke(); };
        const lines: number[][][] = [[[-0.1, -0.95], [0.18, -0.55], [-0.06, -0.2], [0.22, 0.15], [0.05, 0.6]]];
        if (c.stage >= 2) lines.push([[0.18, -0.55], [0.55, -0.4], [0.85, -0.05]], [[-0.06, -0.2], [-0.5, -0.12], [-0.8, 0.25]], [[0.22, 0.15], [0.6, 0.35], [0.7, 0.7]]);
        if (c.stage >= 3) lines.push([[0.05, 0.6], [0.3, 0.9]], [[-0.5, -0.12], [-0.35, 0.4], [-0.6, 0.75]], [[-0.1, -0.95], [-0.45, -0.7], [-0.75, -0.45]], [[0.55, -0.4], [0.5, -0.85]]);
        ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.shadowColor = `rgb(${c.rgb})`; ctx.shadowBlur = 14 + flare * 16; ctx.strokeStyle = `rgba(${c.rgb},${0.55 + flare * 0.45})`; ctx.lineWidth = 3.5 + c.stage + flare * 3; for (const l of lines) seg(l);
        ctx.shadowBlur = 0; ctx.strokeStyle = "#fff8e6"; ctx.lineWidth = 1.2 + flare * 1.5; ctx.globalAlpha = 0.7 + flare * 0.3; for (const l of lines) seg(l);
        ctx.globalAlpha = 1; ctx.strokeStyle = "rgba(35,18,8,0.9)"; ctx.lineWidth = 1.6; for (const l of lines) { ctx.beginPath(); l.forEach((p, i) => (i ? ctx.lineTo(e.x + p[0] * w + 1.5, cy + p[1] * h + 1.5) : ctx.moveTo(e.x + p[0] * w + 1.5, cy + p[1] * h + 1.5))); ctx.stroke(); }
        ctx.restore(); } }
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
