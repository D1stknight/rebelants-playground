// components/RebelGP/car3d.ts
// A modern open-wheel race car built from code (lofted monocoque, sidepods, halo, multi-element wings, Pirelli-style tyres)
// with handles for animation: wheels spin, fronts steer, the body rolls / pitches on its springs, brake + rain lights glow,
// exhaust flames on boost. Driver = helmet in team colours with ant antennae. Shared geometry per chassis, materials per team.
import * as THREE from "three";

export type CarSpec = { len: number; wingF: number; wingR: number; rearH: number; tyreF: number; tyreR: number; pod: number; airbox: number; nose: number; gold: number };
export const CAR_SPECS: Record<string, CarSpec> = {
  scout:   { len: 2.15, wingF: 0.86, wingR: 0.58, rearH: 0.44, tyreF: 0.145, tyreR: 0.15, pod: 0.07, airbox: 0.08, nose: 1.0, gold: 0 },
  soldier: { len: 2.30, wingF: 0.94, wingR: 0.66, rearH: 0.46, tyreF: 0.15, tyreR: 0.158, pod: 0.085, airbox: 0.1, nose: 1.0, gold: 0 },
  tank:    { len: 2.38, wingF: 1.02, wingR: 0.80, rearH: 0.52, tyreF: 0.158, tyreR: 0.18, pod: 0.11, airbox: 0.12, nose: 0.85, gold: 0 },
  drone:   { len: 2.50, wingF: 0.90, wingR: 0.60, rearH: 0.42, tyreF: 0.145, tyreR: 0.155, pod: 0.075, airbox: 0.07, nose: 1.2, gold: 0 },
  royal:   { len: 2.34, wingF: 0.98, wingR: 0.72, rearH: 0.50, tyreF: 0.152, tyreR: 0.165, pod: 0.095, airbox: 0.14, nose: 1.0, gold: 1 },
};
/** world units per "car unit" — a car is ~2.3 car units long → ~24 world units (the sim's karts collide at 16) */
export const CAR_SCALE = 10.5;

type Sec = { x: number; w: number; h: number; y: number; z?: number; p?: number; flat?: number };
function loft(keys: Sec[], rings: number, radial: number) {
  const n = keys.length;
  const cr = (k: keyof Sec, t: number) => {
    const f = t * (n - 1); const i = Math.min(n - 2, Math.floor(f)); const u = f - i;
    const g = (j: number) => Number(keys[Math.max(0, Math.min(n - 1, j))][k] ?? (k === "p" ? 2.6 : 0));
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
  };
  const pos: number[] = [], idx: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings; const x = cr("x", t), w = Math.max(0.002, cr("w", t)), h = Math.max(0.002, cr("h", t)), y = cr("y", t), z = cr("z", t), p = cr("p", t), flat = cr("flat", t);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2; const c = Math.cos(a), s = Math.sin(a);
      const sx = Math.sign(c) * Math.pow(Math.abs(c), 2 / p), sy = Math.sign(s) * Math.pow(Math.abs(s), 2 / p);
      pos.push(x, y + h * (sy < 0 ? sy * (1 - flat * 0.7) : sy), z + w * sx);
    }
  }
  for (let r = 0; r < rings; r++) for (let j = 0; j < radial; j++) { const a = r * radial + j, b = r * radial + ((j + 1) % radial), c = (r + 1) * radial + j, d = (r + 1) * radial + ((j + 1) % radial); idx.push(a, c, b, b, c, d); }
  const cap = (r: number, flip: boolean) => { const ci = pos.length / 3; let cx = 0, cy = 0, cz = 0; for (let j = 0; j < radial; j++) { cx += pos[(r * radial + j) * 3]; cy += pos[(r * radial + j) * 3 + 1]; cz += pos[(r * radial + j) * 3 + 2]; } pos.push(cx / radial, cy / radial, cz / radial); for (let j = 0; j < radial; j++) { const a = r * radial + j, b = r * radial + ((j + 1) % radial); if (flip) idx.push(ci, b, a); else idx.push(ci, a, b); } };
  cap(0, false); cap(rings, true);
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

function textTex(txt: string, fg: string, w = 256, h = 96, font = "900 italic 72px 'Titillium Web', Arial, sans-serif") {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d")!;
  x.fillStyle = fg; x.font = font; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(txt, w / 2, h / 2 + 3);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

type Parts = { body: THREE.BufferGeometry[]; carbon: THREE.BufferGeometry[]; black: THREE.BufferGeometry[]; trim: THREE.BufferGeometry[]; tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry; band: THREE.BufferGeometry; L: number; fx: number; rx: number; rwx: number; rwy: number; rs: number; spec: CarSpec };
const partsCache: Record<string, Parts> = {};
function box(lx: number, ly: number, lz: number, x: number, y: number, z: number, rz = 0) { const g = new THREE.BoxGeometry(lx, ly, lz); if (rz) g.rotateZ(rz); g.translate(x, y, z); return g; }
function tube(pts: number[][], r: number) { return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]))), 8, r, 6, false); }
function merge(gs: THREE.BufferGeometry[]) {
  // tiny merge (positions + normals + index) so each material is one draw call
  let vc = 0; const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (const g0 of gs) { const g = g0.index ? g0 : g0; if (!g.getAttribute("normal")) g.computeVertexNormals(); const p = g.getAttribute("position"), n = g.getAttribute("normal"); for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); } if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + vc); else for (let i = 0; i < p.count; i++) idx.push(i + vc); vc += p.count; }
  const m = new THREE.BufferGeometry(); m.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); m.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); m.setIndex(idx); return m;
}

/** merge geometries into one with a vertex colour per part (one draw call for multi-colour pieces) */
export function mergeColored(list: { g: THREE.BufferGeometry; c: THREE.ColorRepresentation }[]) {
  const pos: number[] = [], nor: number[] = [], col: number[] = []; const cc = new THREE.Color();
  for (const { g, c } of list) { const n = g.index ? g.toNonIndexed() : g; if (!n.getAttribute("normal")) n.computeVertexNormals(); const P = n.getAttribute("position"), N = n.getAttribute("normal"); cc.set(c); for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); col.push(cc.r, cc.g, cc.b); } }
  const m = new THREE.BufferGeometry(); m.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); m.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); m.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); return m;
}
const wheelCache: Record<string, THREE.BufferGeometry> = {};

function parts(k: string): Parts {
  if (partsCache[k]) return partsCache[k];
  const c = CAR_SPECS[k] || CAR_SPECS.soldier; const L = c.len; const nose = c.nose;
  const body: THREE.BufferGeometry[] = [], carbon: THREE.BufferGeometry[] = [], black: THREE.BufferGeometry[] = [], trim: THREE.BufferGeometry[] = [];
  const fx = L * 0.27, rx = -L * 0.25;
  carbon.push(loft([{ x: -L * 0.42, w: 0.17, h: 0.012, y: 0.045 }, { x: -L * 0.3, w: 0.27, h: 0.012, y: 0.045 }, { x: -L * 0.05, w: 0.36, h: 0.012, y: 0.045 }, { x: L * 0.12, w: 0.33, h: 0.012, y: 0.045 }, { x: L * 0.2, w: 0.14, h: 0.012, y: 0.05 }], 10, 10));
  black.push(box(L * 0.07, 0.01, 0.3, -L * 0.43, 0.07, 0, -0.45));
  body.push(loft([
    { x: L * 0.5 * nose, w: 0.028, h: 0.022, y: 0.1, p: 2.2 }, { x: L * 0.42, w: 0.05, h: 0.036, y: 0.112, p: 2.4 }, { x: L * 0.3, w: 0.075, h: 0.055, y: 0.135, p: 2.6 },
    { x: L * 0.17, w: 0.105, h: 0.08, y: 0.165, p: 2.8, flat: 0.5 }, { x: L * 0.06, w: 0.135, h: 0.095, y: 0.19, p: 3.2, flat: 0.6 }, { x: -L * 0.04, w: 0.15, h: 0.105, y: 0.205, p: 3.2, flat: 0.6 },
    { x: -L * 0.14, w: 0.15, h: 0.12, y: 0.22, p: 3.0, flat: 0.6 }, { x: -L * 0.26, w: 0.11, h: 0.1, y: 0.215, p: 2.8, flat: 0.5 }, { x: -L * 0.37, w: 0.06, h: 0.07, y: 0.19, p: 2.6 }, { x: -L * 0.44, w: 0.03, h: 0.035, y: 0.165, p: 2.4 },
  ], 30, 18));
  trim.push(loft([{ x: L * 0.5 * nose + 0.005, w: 0.012, h: 0.012, y: 0.1 }, { x: L * 0.47, w: 0.03, h: 0.024, y: 0.103 }, { x: L * 0.43, w: 0.045, h: 0.03, y: 0.108 }], 4, 10));
  black.push(loft([{ x: L * 0.08, w: 0.07, h: 0.02, y: 0.29 }, { x: L * 0.02, w: 0.1, h: 0.025, y: 0.3 }, { x: -L * 0.05, w: 0.1, h: 0.025, y: 0.305 }, { x: -L * 0.08, w: 0.07, h: 0.02, y: 0.305 }], 6, 12));
  body.push(loft([{ x: -L * 0.05, w: 0.04, h: 0.03, y: 0.31 + c.airbox * 0.3 }, { x: -L * 0.09, w: 0.065, h: 0.075 + c.airbox * 0.35, y: 0.3 + c.airbox * 0.4, p: 2.4 }, { x: -L * 0.17, w: 0.07, h: 0.07 + c.airbox * 0.3, y: 0.29 + c.airbox * 0.3, p: 2.6 }, { x: -L * 0.3, w: 0.045, h: 0.045, y: 0.27, p: 2.6 }, { x: -L * 0.42, w: 0.02, h: 0.02, y: 0.2 }], 14, 12));
  { const g = new THREE.CylinderGeometry(0.035, 0.035, 0.01, 12); g.rotateZ(Math.PI / 2); g.scale(1, 1, 1.3); g.translate(-L * 0.075 + 0.012, 0.33 + c.airbox * 0.55, 0); black.push(g); }
  { const s = new THREE.BufferGeometry(); const x0 = -L * 0.16, x1 = -L * 0.42; const y0 = 0.32 + c.airbox * 0.45, yb = 0.24;
    s.setAttribute("position", new THREE.Float32BufferAttribute([x0, y0, 0.004, x1, yb + 0.12, 0.004, x1, yb, 0.004, x0, yb + 0.04, 0.004, x0, y0, -0.004, x1, yb + 0.12, -0.004, x1, yb, -0.004, x0, yb + 0.04, -0.004], 3)); s.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1]); s.computeVertexNormals(); body.push(s); }
  for (const sz of [1, -1]) {
    const pw = c.pod;
    body.push(loft([{ x: L * 0.12, w: 0.03, h: pw * 0.75, y: 0.17, z: sz * 0.205, p: 3.5 }, { x: L * 0.08, w: 0.07, h: pw * 0.8, y: 0.17, z: sz * 0.225, p: 3.4, flat: 0.8 }, { x: -L * 0.05, w: 0.075, h: pw * 0.75, y: 0.16, z: sz * 0.23, p: 3.0, flat: 0.8 }, { x: -L * 0.2, w: 0.055, h: pw * 0.6, y: 0.145, z: sz * 0.205, p: 2.8, flat: 0.7 }, { x: -L * 0.34, w: 0.02, h: pw * 0.4, y: 0.13, z: sz * 0.15, p: 2.6 }], 14, 12));
    black.push(box(0.012, pw * 1.2, 0.11, L * 0.125, 0.17, sz * 0.225));
    trim.push(loft([{ x: L * 0.1, w: 0.004, h: 0.012, y: 0.17 + pw * 0.55, z: sz * 0.27 }, { x: -L * 0.05, w: 0.004, h: 0.012, y: 0.16 + pw * 0.5, z: sz * 0.302 }, { x: -L * 0.2, w: 0.004, h: 0.01, y: 0.145 + pw * 0.35, z: sz * 0.258 }], 8, 4));
    carbon.push(tube([[L * 0.12, 0.27, sz * 0.12], [L * 0.1, 0.3, sz * 0.2], [L * 0.1, 0.31, sz * 0.24]], 0.006));
    body.push(box(0.03, 0.035, 0.07, L * 0.1, 0.315, sz * 0.26));
  }
  { const halo = new THREE.TorusGeometry(0.115, 0.011, 6, 18, Math.PI); halo.rotateX(-Math.PI / 2); halo.rotateY(Math.PI / 2); halo.scale(1.25, 1, 1); halo.translate(-L * 0.04, 0.37, 0); (c.gold ? trim : carbon).push(halo);
    (c.gold ? trim : carbon).push(tube([[L * 0.1, 0.27, 0], [L * 0.085, 0.34, 0], [L * 0.025, 0.37, 0], [-L * 0.04 + 0.144, 0.37, 0]], 0.011));
    for (const sz of [1, -1]) (c.gold ? trim : carbon).push(tube([[-L * 0.1, 0.37, sz * 0.112], [-L * 0.12, 0.33, sz * 0.12], [-L * 0.13, 0.29, sz * 0.12]], 0.01)); }
  const fwx = L * 0.47 * Math.max(0.95, nose * 0.98); const span = c.wingF / 2;
  carbon.push(box(0.1, 0.01, c.wingF, fwx + 0.02, 0.035, 0, 0.05)); trim.push(box(0.075, 0.009, c.wingF * 0.96, fwx - 0.04, 0.055, 0, 0.22)); body.push(box(0.06, 0.008, c.wingF * 0.92, fwx - 0.085, 0.078, 0, 0.42));
  for (const sz of [1, -1]) { body.push(box(0.16, 0.09, 0.008, fwx - 0.03, 0.065, sz * span)); trim.push(box(0.03, 0.06, 0.01, fwx + 0.03, 0.06, sz * (span - 0.004))); carbon.push(box(0.07, 0.06, 0.008, fwx - 0.02, 0.075, sz * 0.03)); }
  const rwx = -L * 0.45, rwy = c.rearH, rs = c.wingR / 2;
  carbon.push(box(0.13, 0.014, c.wingR, rwx, rwy, 0, 0.12)); body.push(box(0.09, 0.012, c.wingR, rwx - 0.005, rwy + 0.055, 0, 0.45));
  for (const sz of [1, -1]) { body.push(box(0.2, rwy - 0.12, 0.01, rwx + 0.01, (rwy + 0.14) / 2 + 0.03, sz * rs)); trim.push(box(0.2, 0.03, 0.012, rwx + 0.01, rwy + 0.075, sz * rs)); }
  carbon.push(tube([[-L * 0.36, 0.24, 0], [-L * 0.42, 0.32, 0], [rwx + 0.02, rwy + 0.02, 0]], 0.012)); carbon.push(box(0.06, 0.01, c.wingR * 0.85, rwx + 0.04, 0.2, 0, 0.2));
  // suspension wishbones (static, to the hubs)
  for (const sz of [1, -1]) for (const [x, R, wd] of [[fx, c.tyreF, 0.12], [rx, c.tyreR, 0.16]] as number[][]) { const z = sz * (0.33 + wd / 2); for (const [dx, dy] of [[0.05, 0.03], [-0.05, 0.03], [0.04, -0.03]]) carbon.push(tube([[x + dx, R + dy, sz * 0.1], [x + dx * 0.4, R + dy * 0.6, z - sz * wd * 0.4]], 0.007)); }
  // one wheel (unit radius 1, width 1 → scaled per axle): rounded tyre, rim, coloured sidewall band
  const prof: THREE.Vector2[] = []; const rr = 0.32;
  prof.push(new THREE.Vector2(0.62, -0.5)); for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + (i / 5) * (Math.PI / 2); prof.push(new THREE.Vector2(1 - rr * 0.36 + Math.cos(a) * rr * 0.36, -0.5 + rr + Math.sin(a) * rr)); }
  for (let i = 0; i <= 5; i++) { const a = (i / 5) * (Math.PI / 2); prof.push(new THREE.Vector2(1 - rr * 0.36 + Math.cos(a) * rr * 0.36, 0.5 - rr + Math.sin(a) * rr)); } prof.push(new THREE.Vector2(0.62, 0.5));
  const tyre = new THREE.LatheGeometry(prof, 24); tyre.rotateX(Math.PI / 2);
  const rim = merge([(() => { const g = new THREE.CylinderGeometry(0.6, 0.6, 1.02, 18); g.rotateX(Math.PI / 2); return g; })(), ...[0, 1, 2, 3, 4].map((i) => { const g = new THREE.BoxGeometry(0.08, 1.1, 1.04); g.rotateZ((i / 5) * Math.PI); return g; })]);
  const band = merge([1, -1].map((s) => { const g = new THREE.TorusGeometry(0.8, 0.035, 4, 24); g.translate(0, 0, s * 0.505); return g; }));
  const P: Parts = { body: [merge(body)], carbon: [merge(carbon)], black: [merge(black)], trim: [merge(trim)], tyre, rim, band, L, fx, rx, rwx, rwy, rs, spec: c };
  partsCache[k] = P; return P;
}

let _wm: THREE.MeshStandardMaterial | null = null; const wheelMat = () => (_wm ||= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.35 }));
export type Car3D = {
  root: THREE.Group;      // world placement (x, z, heading)
  chassis: THREE.Group;   // rolls / pitches / hops on its springs
  wheels: { spin: THREE.Object3D; steer: THREE.Object3D | null; r: number }[];
  brake: THREE.MeshStandardMaterial; flame: THREE.Mesh; shadow: THREE.Mesh; helmet: THREE.Group;
  roll: number; pitch: number; slip: number; spinA: number; wheelA: number; lastSpeed: number;
};

const shadowTex = (() => { let t: THREE.Texture | null = null; return () => { if (t) return t; const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d")!; const g = x.createRadialGradient(32, 32, 2, 32, 32, 31); g.addColorStop(0, "rgba(0,0,0,0.75)"); g.addColorStop(0.6, "rgba(0,0,0,0.35)"); g.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 64); t = new THREE.CanvasTexture(c); return t; }; })();

export function buildCar(chassis: string, paint: string, accent: string, num: string, castShadow: boolean): Car3D {
  const P = parts(chassis); const c = P.spec;
  const mPaint = new THREE.MeshPhysicalMaterial({ color: paint, metalness: 0.15, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.12, envMapIntensity: 0.45, side: THREE.DoubleSide });
  const mAcc = new THREE.MeshPhysicalMaterial({ color: c.gold ? "#e6c15a" : accent, metalness: c.gold ? 1 : 0.3, roughness: c.gold ? 0.2 : 0.3, clearcoat: 1 });
  const mCarbon = new THREE.MeshStandardMaterial({ color: "#16171b", metalness: 0.2, roughness: 0.45, envMapIntensity: 0.35 });
  const mBlack = new THREE.MeshStandardMaterial({ color: "#0b0b0e", roughness: 0.85 });
  const mWheel = wheelMat();
  const brake = new THREE.MeshStandardMaterial({ color: "#550000", emissive: "#ff1a1a", emissiveIntensity: 0.4 });
  const root = new THREE.Group(); const chassisG = new THREE.Group(); const inner = new THREE.Group(); inner.scale.setScalar(CAR_SCALE); chassisG.add(inner); root.add(chassisG);
  const add = (g: THREE.BufferGeometry, m: THREE.Material) => { const me = new THREE.Mesh(g, m); me.castShadow = castShadow; inner.add(me); return me; };
  P.body.forEach((g) => add(g, mPaint)); P.carbon.forEach((g) => add(g, mCarbon)); P.black.forEach((g) => add(g, mBlack)); P.trim.forEach((g) => add(g, mAcc));
  // rain light + brake glow
  const rl = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.04, 0.03), brake); rl.position.set(-P.L * 0.47, 0.155, 0); inner.add(rl);
  // decals: REBEL on the rear wing (seen from behind all race), number on the nose and engine cover
  const dec = (tex: THREE.Texture, w: number, h: number, pos: number[], rot: number[]) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false })); m.position.set(pos[0], pos[1], pos[2]); m.rotation.set(rot[0], rot[1], rot[2], "YXZ"); inner.add(m); };
  dec(textTex("REBEL", "#ffffff"), 0.26, 0.07, [P.rwx - 0.058, P.rwy + 0.084, 0], [0, -Math.PI / 2, 0]);
  const nt = textTex(num, "#ffffff", 128, 96, "900 italic 80px 'Titillium Web', Arial, sans-serif");
  dec(nt, 0.09, 0.06, [P.L * 0.33, 0.196, 0], [-Math.PI / 2 + 0.28, -Math.PI / 2, 0]);
  // driver: helmet in team colours, dark visor, two little antennae
  const helmet = new THREE.Group(); helmet.position.set(-P.L * 0.02, 0.33, 0); inner.add(helmet);
  { const shell = new THREE.SphereGeometry(0.075, 14, 10); shell.scale(1.1, 1, 1);
    const stripe = new THREE.TorusGeometry(0.076, 0.012, 5, 18, Math.PI); stripe.rotateZ(Math.PI / 2); stripe.rotateY(Math.PI / 2);
    const vis = new THREE.SphereGeometry(0.077, 12, 6, -0.9, 1.8, 1.2, 0.55); vis.rotateY(Math.PI / 2); vis.scale(1.1, 1, 1);
    const ants = [1, -1].flatMap((sz) => [{ g: tube([[-0.01, 0.06, sz * 0.03], [0.02, 0.13, sz * 0.05], [0.06, 0.16, sz * 0.07]], 0.006), c: 0x111111 }, { g: new THREE.SphereGeometry(0.014, 6, 4).translate(0.06, 0.16, sz * 0.07), c: paint }]);
    const hm = new THREE.Mesh(mergeColored([{ g: shell, c: accent }, { g: stripe, c: paint }, { g: vis, c: 0x0c0f18 }, ...ants]), new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.3, roughness: 0.25, clearcoat: 1 })); hm.castShadow = castShadow; helmet.add(hm); }
  // wheels
  const wheels: Car3D["wheels"] = [];
  for (const [x, R, wd, front] of [[P.fx, c.tyreF, 0.12, 1], [P.rx, c.tyreR, 0.16, 0]] as number[][]) for (const sz of [1, -1]) {
    const pivot = new THREE.Group(); pivot.position.set(x, R, sz * (0.33 + wd / 2)); inner.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin); spin.scale.set(R, R, wd);
    const wk = chassis + (c.gold ? "g" : ""); const wg = (wheelCache[wk] ||= mergeColored([{ g: P.tyre, c: 0x19191c }, { g: P.rim, c: c.gold ? 0xe2b84f : 0x2b2c32 }, { g: P.band, c: 0xf6d23a }]));
    const t = new THREE.Mesh(wg, mWheel); t.castShadow = castShadow; spin.add(t);
    wheels.push({ spin, steer: front ? pivot : null, r: R * CAR_SCALE });
  }
  // exhaust flame (boost)
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.22, 10, 1, true), new THREE.MeshBasicMaterial({ color: "#7fd3ff", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.rotation.z = Math.PI / 2; flame.position.set(-P.L * 0.5 - 0.1, 0.16, 0); inner.add(flame);
  // soft contact shadow
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(P.L * CAR_SCALE * 1.15, 0.95 * CAR_SCALE), new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false, opacity: 0.85 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.06; root.add(shadow);
  return { root, chassis: chassisG, wheels, brake, flame, shadow, helmet, roll: 0, pitch: 0, slip: 0, spinA: 0, wheelA: 0, lastSpeed: 0 };
}

/** per-frame animation from the sim's kart state */
export function animateCar(car: Car3D, k: { x: number; y: number; h: number; speed: number; steer: number; drift: number; spin: number; hop: number; boost: number }, braking: boolean, dt: number, t: number) {
  const accel = (k.speed - car.lastSpeed) / Math.max(1e-3, dt); car.lastSpeed = k.speed;
  // springs: roll into the turn, squat on throttle, dive on brakes
  const rollT = -k.steer * Math.min(1, k.speed / 120) * 0.05 - k.drift * 0.03; const pitchT = Math.max(-0.03, Math.min(0.03, -accel * 0.0004));
  car.roll += (rollT - car.roll) * Math.min(1, dt * 8); car.pitch += (pitchT - car.pitch) * Math.min(1, dt * 6);
  car.slip += ((k.drift ? k.drift * 0.38 : 0) - car.slip) * Math.min(1, dt * 6);
  if (k.spin > 0) car.spinA += dt * 14; else car.spinA *= Math.max(0, 1 - dt * 8);
  car.root.position.set(k.x, 0, k.y);
  car.root.rotation.y = -k.h - car.slip - car.spinA;     // sim heading: atan2(dy, dx) in the x/z plane
  const hop = k.hop > 0 ? Math.sin(k.hop * Math.PI) * 1.4 : 0; const buzz = Math.sin(t * 60) * 0.03 * Math.min(1, k.speed / 100);
  car.chassis.position.y = hop + buzz; car.chassis.rotation.set(car.roll, 0, car.pitch);
  car.wheelA += (k.speed / (car.wheels[0]?.r || 1.6)) * dt;
  for (const w of car.wheels) { w.spin.rotation.z = -car.wheelA; if (w.steer) w.steer.rotation.y = -k.steer * 0.32 - (k.drift ? -k.drift * 0.2 : 0); }
  car.brake.emissiveIntensity = braking ? 3 : 0.35 + (Math.sin(t * 9) > 0.6 ? 0.8 : 0);
  car.flame.visible = k.boost > 0; const fm = car.flame.material as THREE.MeshBasicMaterial; fm.opacity = k.boost > 0 ? 0.65 + Math.random() * 0.35 : 0; car.flame.scale.set(1, k.boost > 0 ? 1 + Math.random() * 0.8 : 1, 1);
  car.shadow.position.y = 0.06; (car.shadow.material as THREE.MeshBasicMaterial).opacity = 0.85 - Math.min(0.5, hop * 0.3);
}
