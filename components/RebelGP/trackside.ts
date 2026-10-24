// components/RebelGP/trackside.ts
// Broadcast dressing for Rebel Grand Prix, painted at runtime into canvases (no extra downloads):
//   - a seamless HD sky panorama per biome (gradient, sun glow, clouds or stars, two layers of skyline that parallax)
//   - trackside billboards: the start-light gantry over the line, grandstands with a crowd, sponsor boards on the corners.
export type Panorama = { far: HTMLCanvasElement; mid: HTMLCanvasElement; haze: string };
export type Side = { x: number; y: number; img: HTMLCanvasElement | HTMLCanvasElement[]; w: number; h: number; kind: "gantry" | "stand" | "board" };

const PW = 960; // panorama tile width in logical px (two tiles per full turn for the far layer)
type SkyPal = { top: string; mid: string; low: string; sun: string | null; far: string; mid2: string; haze: string; clouds: boolean; stars: boolean; skyline: "hills" | "pipes" | "castle" | "spires" | "garden" };
const SKY: Record<string, SkyPal> = {
  jungle:   { top: "#3d7fc4", mid: "#7fb6e3", low: "#d6ecf5", sun: "rgba(255,244,214,0.9)", far: "#4f7f63", mid2: "#24502f", haze: "rgba(200,226,236,", clouds: true, stars: false, skyline: "hills" },
  garden:   { top: "#2f86e0", mid: "#78b8f0", low: "#e2f2fb", sun: "rgba(255,248,220,0.95)", far: "#6c9a74", mid2: "#3c7a3f", haze: "rgba(214,236,246,", clouds: true, stars: false, skyline: "garden" },
  sewers:   { top: "#05080a", mid: "#0f171b", low: "#22313a", sun: null, far: "#1a2328", mid2: "#0c1215", haze: "rgba(34,49,58,", clouds: false, stars: false, skyline: "pipes" },
  fortress: { top: "#3b1d3c", mid: "#c45a3a", low: "#ffc27a", sun: "rgba(255,190,110,0.95)", far: "#6b3a35", mid2: "#2c1a1c", haze: "rgba(255,180,120,", clouds: true, stars: false, skyline: "castle" },
  throne:   { top: "#080214", mid: "#2a0b44", low: "#6a2a7a", sun: "rgba(255,120,230,0.6)", far: "#3a1650", mid2: "#16061f", haze: "rgba(110,50,130,", clouds: false, stars: true, skyline: "spires" },
};
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function canvas(w: number, h: number) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
/** periodic ridge: integer harmonics so it wraps seamlessly across the tile */
function ridge(r: () => number, n: number) { const hs = Array.from({ length: n }, (_, i) => ({ k: i + 1 + Math.floor(r() * 3), a: r() / (i + 1), p: r() * Math.PI * 2 })); return (u: number) => hs.reduce((s, h) => s + h.a * Math.sin(u * Math.PI * 2 * h.k + h.p), 0); }

export function buildPanorama(biome: string, H: number, RES: number, seed = 7): Panorama {
  const p = SKY[biome] || SKY.jungle; const r = rng(seed);
  const W = PW * RES, HH = H * RES;
  // far: the sky itself + distant skyline
  const far = canvas(W, HH); const c = far.getContext("2d")!;
  const g = c.createLinearGradient(0, 0, 0, HH); g.addColorStop(0, p.top); g.addColorStop(0.62, p.mid); g.addColorStop(1, p.low); c.fillStyle = g; c.fillRect(0, 0, W, HH);
  if (p.sun) { const sx = W * 0.3, sy = HH * 0.72; const sg = c.createRadialGradient(sx, sy, 0, sx, sy, HH * 0.9); sg.addColorStop(0, p.sun); sg.addColorStop(0.25, p.sun.replace(/[\d.]+\)$/, "0.25)")); sg.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = sg; c.fillRect(0, 0, W, HH); }
  if (p.stars) for (let i = 0; i < 260; i++) { const x = r() * W, y = r() * HH * 0.8, s = r() * 1.4 * RES; c.fillStyle = `rgba(255,${200 + r() * 55 | 0},255,${0.3 + r() * 0.7})`; c.fillRect(x, y, s, s); }
  if (p.clouds) for (let i = 0; i < 26; i++) {
    const cx = r() * W, cy = HH * (0.12 + r() * 0.45), cw = (60 + r() * 140) * RES, ch = cw * (0.18 + r() * 0.12);
    for (const dx of [-W, 0, W]) for (let k = 0; k < 7; k++) { const bx = cx + dx + (r() - 0.5) * cw, by = cy + (r() - 0.6) * ch, br = ch * (0.5 + r() * 0.7); const cg = c.createRadialGradient(bx, by, 0, bx, by, br); const a = biome === "fortress" ? "255,214,180" : "255,255,255"; cg.addColorStop(0, `rgba(${a},0.55)`); cg.addColorStop(1, `rgba(${a},0)`); c.fillStyle = cg; c.beginPath(); c.arc(bx, by, br, 0, Math.PI * 2); c.fill(); }
  }
  const f1 = ridge(r, 6);
  c.fillStyle = p.far; c.beginPath(); c.moveTo(0, HH);
  for (let x = 0; x <= W; x += 2) { const u = x / W; let y = HH * (0.78 - f1(u) * 0.16); if (p.skyline === "castle") y = Math.min(y, HH * (0.74 - (Math.floor(u * 40) % 5 === 0 ? 0.12 : 0))); if (p.skyline === "spires") y -= Math.max(0, Math.sin(u * Math.PI * 2 * 9 + 1) - 0.82) * HH * 2.2; c.lineTo(x, y); }
  c.lineTo(W, HH); c.closePath(); c.fill();
  // haze over the far ridge
  const hg = c.createLinearGradient(0, HH * 0.55, 0, HH); hg.addColorStop(0, p.haze + "0)"); hg.addColorStop(1, p.haze + "0.55)"); c.fillStyle = hg; c.fillRect(0, HH * 0.55, W, HH * 0.45);

  // mid: nearer skyline (trees, pipes, battlements, crystals, hedges + house) — transparent above
  const mid = canvas(W, HH); const m = mid.getContext("2d")!; const f2 = ridge(r, 8);
  const base = (u: number) => HH * (0.9 - f2(u) * 0.07);
  m.fillStyle = p.mid2;
  if (p.skyline === "hills" || p.skyline === "garden") {
    // tree canopy: overlapping round crowns along a ridge, wrapping
    m.beginPath(); m.moveTo(0, HH); for (let x = 0; x <= W; x += 4) m.lineTo(x, base(x / W)); m.lineTo(W, HH); m.closePath(); m.fill();
    for (let i = 0; i < 120; i++) { const x = r() * W, rr = (6 + r() * 16) * RES, y = base(x / W) - rr * 0.4; for (const dx of [-W, 0, W]) { m.beginPath(); m.arc(x + dx, y, rr, 0, Math.PI * 2); m.fill(); } }
    if (p.skyline === "garden") { m.fillStyle = "#7a5a46"; const hx = W * 0.62, hy = base(0.62) - 34 * RES; m.fillRect(hx, hy, 70 * RES, 36 * RES); m.fillStyle = "#4a2f28"; m.beginPath(); m.moveTo(hx - 8 * RES, hy); m.lineTo(hx + 35 * RES, hy - 24 * RES); m.lineTo(hx + 78 * RES, hy); m.fill(); }
  } else if (p.skyline === "pipes") {
    m.beginPath(); m.moveTo(0, HH); for (let x = 0; x <= W; x += 4) m.lineTo(x, base(x / W)); m.lineTo(W, HH); m.closePath(); m.fill();
    for (let i = 0; i < 18; i++) { const x = r() * W, w = (8 + r() * 14) * RES, h = (20 + r() * 50) * RES; m.fillRect(x, base(x / W) - h, w, h); m.fillRect(x - w * 0.3, base(x / W) - h, w * 1.6, 4 * RES); }
    m.strokeStyle = p.mid2; m.lineWidth = 8 * RES; for (let i = 0; i < 5; i++) { const y = HH * (0.35 + r() * 0.3); m.beginPath(); m.moveTo(0, y); m.lineTo(W, y + (r() - 0.5) * 10); m.stroke(); }
    for (let i = 0; i < 10; i++) { const x = r() * W, y = HH * (0.4 + r() * 0.3); const lg = m.createRadialGradient(x, y, 0, x, y, 24 * RES); lg.addColorStop(0, "rgba(160,255,190,0.5)"); lg.addColorStop(1, "rgba(160,255,190,0)"); m.fillStyle = lg; m.fillRect(x - 24 * RES, y - 24 * RES, 48 * RES, 48 * RES); m.fillStyle = p.mid2; }
  } else if (p.skyline === "castle") {
    m.beginPath(); m.moveTo(0, HH); for (let x = 0; x <= W; x += 3 * RES) { const u = x / W; const merl = Math.floor(x / (6 * RES)) % 2 === 0 ? 5 * RES : 0; m.lineTo(x, HH * 0.8 - merl); m.lineTo(x + 3 * RES, HH * 0.8 - merl); } m.lineTo(W, HH); m.closePath(); m.fill();
    for (let i = 0; i < 6; i++) { const x = (i / 6 + r() * 0.08) * W, w = 26 * RES, h = (40 + r() * 30) * RES; m.fillRect(x, HH * 0.8 - h, w, h); for (let k = 0; k < 4; k++) m.fillRect(x - 3 * RES + k * 9 * RES, HH * 0.8 - h - 6 * RES, 5 * RES, 6 * RES); m.fillStyle = "rgba(255,170,80,0.85)"; m.fillRect(x + w * 0.4, HH * 0.8 - h * 0.6, 4 * RES, 7 * RES); m.fillStyle = p.mid2; }
  } else {
    m.beginPath(); m.moveTo(0, HH); for (let x = 0; x <= W; x += 4) m.lineTo(x, base(x / W)); m.lineTo(W, HH); m.closePath(); m.fill();
    for (let i = 0; i < 22; i++) { const x = r() * W, w = (6 + r() * 10) * RES, h = (24 + r() * 60) * RES, b = base(x / W); m.beginPath(); m.moveTo(x - w, b); m.lineTo(x, b - h); m.lineTo(x + w, b); m.fill(); const cg = m.createLinearGradient(x, b - h, x, b); cg.addColorStop(0, "rgba(255,120,240,0.55)"); cg.addColorStop(1, "rgba(255,120,240,0)"); m.fillStyle = cg; m.beginPath(); m.moveTo(x - w * 0.3, b); m.lineTo(x, b - h); m.lineTo(x + w * 0.15, b); m.fill(); m.fillStyle = p.mid2; }
  }
  return { far, mid, haze: p.haze };
}

/** draw the panorama: far layer turns 2× per lap of the heading, mid layer 4× (feels nearer) */
export function drawPanorama(c: CanvasRenderingContext2D, pano: Panorama, camH: number, vw: number, horizon: number, sy: number) {
  const turn = camH / (Math.PI * 2);
  for (const [img, rate] of [[pano.far, 2], [pano.mid, 4]] as [HTMLCanvasElement, number][]) {
    const off = (((turn * rate * PW) % PW) + PW) % PW;
    for (let k = -1; k * PW - off < vw; k++) c.drawImage(img, k * PW - off, sy, PW, horizon + 1);
  }
}

// ── trackside billboards ───────────────────────────────────────────────────────────────────
function gantry(lit: number, RES: number): HTMLCanvasElement {
  const W = 240 * RES, H = 90 * RES; const cv = canvas(W, H); const c = cv.getContext("2d")!;
  const steel = c.createLinearGradient(0, 0, 0, 30 * RES); steel.addColorStop(0, "#4a4d57"); steel.addColorStop(1, "#22242b");
  // posts
  c.fillStyle = "#2a2c33"; c.fillRect(6 * RES, 20 * RES, 7 * RES, H - 20 * RES); c.fillRect(W - 13 * RES, 20 * RES, 7 * RES, H - 20 * RES);
  // beam with sponsor panel
  c.fillStyle = steel; c.fillRect(0, 8 * RES, W, 26 * RES);
  c.fillStyle = "#e10600"; c.fillRect(0, 8 * RES, W, 3 * RES);
  c.fillStyle = "#fff"; c.font = `900 italic ${13 * RES}px 'Titillium Web', Arial, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("REBEL GRAND PRIX", W / 2, 22 * RES);
  // light pods below the beam
  for (let i = 0; i < 5; i++) {
    const x = W / 2 + (i - 2) * 26 * RES - 9 * RES, y = 36 * RES; c.fillStyle = "#0b0b0e"; c.fillRect(x, y, 18 * RES, 34 * RES);
    for (let k = 0; k < 2; k++) { const cx = x + 9 * RES, cy = y + (9 + k * 16) * RES; const on = k === 1 && lit > i;
      if (on) { const gg = c.createRadialGradient(cx, cy, 0, cx, cy, 14 * RES); gg.addColorStop(0, "rgba(255,60,30,0.9)"); gg.addColorStop(1, "rgba(255,30,0,0)"); c.fillStyle = gg; c.fillRect(cx - 14 * RES, cy - 14 * RES, 28 * RES, 28 * RES); }
      c.fillStyle = on ? "#ff3a1a" : "#2a1414"; c.beginPath(); c.arc(cx, cy, 6 * RES, 0, Math.PI * 2); c.fill(); }
  }
  return cv;
}
function stand(r: () => number, RES: number, roof: string): HTMLCanvasElement {
  const W = 260 * RES, H = 92 * RES; const cv = canvas(W, H); const c = cv.getContext("2d")!;
  // structure: tiers rising to the back, roof on pillars
  c.fillStyle = "#2b2f38"; c.beginPath(); c.moveTo(0, H); c.lineTo(10 * RES, 30 * RES); c.lineTo(W - 10 * RES, 30 * RES); c.lineTo(W, H); c.closePath(); c.fill();
  const rows = 9;
  for (let k = 0; k < rows; k++) { const y0 = 32 * RES + k * ((H - 40 * RES) / rows); c.fillStyle = k % 2 ? "#3b404c" : "#343844"; c.fillRect(8 * RES, y0, W - 16 * RES, (H - 40 * RES) / rows);
    for (let x = 12 * RES; x < W - 12 * RES; x += 3.2 * RES) { if (r() < 0.12) continue; const cols = ["#e74c3c", "#f1c40f", "#ecf0f1", "#3498db", "#2ecc71", "#e67e22", "#9b59b6", "#1abc9c", "#ffffff"]; c.fillStyle = cols[(r() * cols.length) | 0]; c.beginPath(); c.arc(x, y0 + 2.2 * RES, 1.3 * RES, 0, Math.PI * 2); c.fill(); } }
  // front wall with a sponsor band
  c.fillStyle = "#e10600"; c.fillRect(0, H - 10 * RES, W, 10 * RES); c.fillStyle = "#fff"; c.font = `900 italic ${8 * RES}px 'Titillium Web', Arial, sans-serif`; c.textBaseline = "middle";
  for (let x = 6 * RES; x < W; x += 70 * RES) c.fillText("REBEL ANTS", x, H - 5 * RES);
  // roof
  c.fillStyle = "#1d2027"; for (const x of [14, 90, 170, 244]) c.fillRect(x * RES, 6 * RES, 3 * RES, 26 * RES);
  const rg = c.createLinearGradient(0, 0, 0, 10 * RES); rg.addColorStop(0, roof); rg.addColorStop(1, "#16181d"); c.fillStyle = rg; c.fillRect(0, 0, W, 9 * RES);
  return cv;
}
function board(txt: string, fg: string, bg: string, RES: number): HTMLCanvasElement {
  const W = 150 * RES, H = 34 * RES; const cv = canvas(W, H); const c = cv.getContext("2d")!;
  c.fillStyle = "#1a1b20"; c.fillRect(8 * RES, 24 * RES, 4 * RES, 10 * RES); c.fillRect(W - 12 * RES, 24 * RES, 4 * RES, 10 * RES);
  c.fillStyle = bg; c.fillRect(0, 0, W, 25 * RES); c.fillStyle = "rgba(255,255,255,0.18)"; c.fillRect(0, 0, W, 3 * RES);
  c.fillStyle = fg; c.font = `900 italic ${17 * RES}px 'Titillium Web', Arial, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(txt, W / 2, 13 * RES);
  return cv;
}

/** places the gantry over the start line, grandstands down the start straight and sponsor boards on the outside of corners */
export function buildTrackside(center: [number, number][], width: number, isGrass: (x: number, y: number) => boolean, RES: number, seed = 3): Side[] {
  const r = rng(seed); const N = center.length; const out: Side[] = [];
  const tan = (i: number) => { i = ((i % N) + N) % N; const a = center[(i + 1) % N], b = center[(i - 1 + N) % N]; const dx = a[0] - b[0], dy = a[1] - b[1]; const L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; };
  const nrm = (i: number) => { const t = tan(i); return [-t[1], t[0]]; };
  const at = (i: number, d: number) => { const c = center[(i + N) % N], n = nrm((i + N) % N); return [c[0] + n[0] * d, c[1] + n[1] * d]; };
  // gantry: lights state is chosen per frame (img is a list indexed by lights on)
  const g0 = center[0]; out.push({ x: g0[0], y: g0[1], img: [0, 1, 2, 3, 4, 5].map((l) => gantry(l, RES)), w: width + 34, h: (width + 34) * (90 / 240), kind: "gantry" });
  // grandstands along the start straight, on whichever side has room
  const stands = [stand(r, RES, "#e10600"), stand(r, RES, "#1e3a8a")];
  for (const [i, side] of [[-10, -1], [10, -1], [-10, 1], [10, 1]] as [number, number][]) {
    const [x, y] = at(i, side * (width / 2 + 52)); if (!isGrass(x, y)) continue;
    out.push({ x, y, img: stands[(i > 0 ? 1 : 0)], w: 92, h: 92 * (92 / 260), kind: "stand" });
  }
  // sponsor boards on the outside of the tighter corners
  const curv = center.map((_, i) => { const a = tan(i - 2), b = tan(i + 2); return a[0] * b[1] - a[1] * b[0]; });
  const sorted = curv.map((k, i) => [Math.abs(k), i]).sort((a, b) => b[0] - a[0]);
  const used: number[] = []; const boards = [board("REBEL", "#ffffff", "#e10600", RES), board("$REBEL", "#111111", "#ffd400", RES), board("REBEL ANTS", "#ffffff", "#15151e", RES), board("PLAY.REBELANTS.IO", "#15151e", "#ffffff", RES)];
  for (const [, i] of sorted) {
    if (used.length >= 9) break; if (used.some((u) => Math.min(Math.abs(u - i), N - Math.abs(u - i)) < N / 14)) continue;
    const side = curv[i] > 0 ? -1 : 1; const [x, y] = at(i, side * (width / 2 + 30)); if (!isGrass(x, y)) continue;
    used.push(i); out.push({ x, y, img: boards[used.length % boards.length], w: 34, h: 34 * (34 / 150), kind: "board" });
  }
  void r;
  return out;
}
