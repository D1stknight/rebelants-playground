// Dev-only (copy to pages/dev/f1.tsx): a faction rider in a modern Formula-1 style car, for the Rebel Grand Prix HD sprite sheets.
// ?f=<faction>&k=<chassis>&p=<paint hex>&a=<accent hex>&n=<car number>
// window.__pose(opts) seats the rider, __cam(hMul, pitch) frames the car, __yaw(a) turns it, __shot() returns a PNG data URL.
// Chassis variants change proportions (wings, pods, tyres) so each class still reads differently from behind.
import React, { useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { useGLTF, useFBX } from "@react-three/drei";
import {
  AnimationMixer, Box3, BoxGeometry, BufferGeometry, CanvasTexture, CatmullRomCurve3, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, LatheGeometry,
  Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, PMREMGenerator, SRGBColorSpace, TorusGeometry, TubeGeometry, Vector2, Vector3, type Material, type Object3D,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

type Spec = { len: number; wingF: number; wingR: number; rearH: number; tyreF: number; tyreR: number; pod: number; airbox: number; nose: number; gold: number };
export const SPECS: Record<string, Spec> = {
  //        length  f.wing  r.wing  r.wing h  tyre F  tyre R  pod    airbox  nose   gold trim
  scout:   { len: 2.15, wingF: 0.86, wingR: 0.58, rearH: 0.44, tyreF: 0.145, tyreR: 0.15, pod: 0.07, airbox: 0.08, nose: 1.0, gold: 0 },
  soldier: { len: 2.30, wingF: 0.94, wingR: 0.66, rearH: 0.46, tyreF: 0.15, tyreR: 0.158, pod: 0.085, airbox: 0.1, nose: 1.0, gold: 0 },
  tank:    { len: 2.38, wingF: 1.02, wingR: 0.80, rearH: 0.52, tyreF: 0.158, tyreR: 0.18, pod: 0.11, airbox: 0.12, nose: 0.85, gold: 0 },
  drone:   { len: 2.50, wingF: 0.90, wingR: 0.60, rearH: 0.42, tyreF: 0.145, tyreR: 0.155, pod: 0.075, airbox: 0.07, nose: 1.2, gold: 0 },
  royal:   { len: 2.34, wingF: 0.98, wingR: 0.72, rearH: 0.50, tyreF: 0.152, tyreR: 0.165, pod: 0.095, airbox: 0.14, nose: 1.0, gold: 1 },
};

/** smooth body from cross-sections along x: each { x, w (half width), h (half height), y (centre), z (centre), p (squareness 2…5) } */
type Sec = { x: number; w: number; h: number; y: number; z?: number; p?: number; flat?: number };
function loft(keys: Sec[], rings = 48, radial = 28) {
  const n = keys.length; const cr = (k: keyof Sec, t: number) => {
    const f = t * (n - 1); const i = Math.min(n - 2, Math.floor(f)); const u = f - i;
    const g = (j: number) => Number(keys[Math.max(0, Math.min(n - 1, j))][k] ?? (k === "p" ? 2.6 : 0));
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
  };
  const pos: number[] = []; const idx: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings; const x = cr("x", t), w = Math.max(0.002, cr("w", t)), h = Math.max(0.002, cr("h", t)), y = cr("y", t), z = cr("z", t), p = cr("p", t), flat = cr("flat", t);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2; const c = Math.cos(a), s = Math.sin(a);
      const sx = Math.sign(c) * Math.pow(Math.abs(c), 2 / p), sy = Math.sign(s) * Math.pow(Math.abs(s), 2 / p);
      const yy = sy < 0 ? sy * (1 - flat * 0.7) : sy;   // flatter underside
      pos.push(x, y + h * yy, z + w * sx);
    }
  }
  for (let r = 0; r < rings; r++) for (let j = 0; j < radial; j++) {
    const a = r * radial + j, b = r * radial + ((j + 1) % radial), c = (r + 1) * radial + j, d = (r + 1) * radial + ((j + 1) % radial);
    idx.push(a, c, b, b, c, d);
  }
  // caps
  const cap = (r: number, flip: boolean) => { const ci = pos.length / 3; let cx = 0, cy = 0, cz = 0; for (let j = 0; j < radial; j++) { cx += pos[(r * radial + j) * 3]; cy += pos[(r * radial + j) * 3 + 1]; cz += pos[(r * radial + j) * 3 + 2]; } pos.push(cx / radial, cy / radial, cz / radial); for (let j = 0; j < radial; j++) { const a = r * radial + j, b = r * radial + ((j + 1) % radial); if (flip) idx.push(ci, b, a); else idx.push(ci, a, b); } };
  cap(0, false); cap(rings, true);
  const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

function textTex(txt: string, fg: string, bg: string | null, w = 512, h = 128, font = "900 92px Poppins, Arial Black, sans-serif") {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d")!;
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  x.fillStyle = fg; x.font = font; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(txt, w / 2, h / 2 + 4);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.anisotropy = 8; return t;
}

function buildF1(H: number, k: string, paint: string, accent: string, num: string) {
  const c = SPECS[k] || SPECS.soldier; const L = c.len; const g = new Group(); const u = H;   // build in rider-height units, scale at the end
  const mPaint = new MeshPhysicalMaterial({ color: paint, metalness: 0.35, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 });
  const mAcc = new MeshPhysicalMaterial({ color: accent, metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
  const mCarbon = new MeshPhysicalMaterial({ color: "#1b1c21", metalness: 0.4, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25 });
  const mBlack = new MeshStandardMaterial({ color: "#0d0d10", roughness: 0.8 });
  const mTyre = new MeshStandardMaterial({ color: "#1a1a1d", roughness: 0.92 });
  const mRim = new MeshPhysicalMaterial({ color: c.gold ? "#e2b84f" : "#2a2b31", metalness: 0.9, roughness: 0.25 });
  const mGold = new MeshPhysicalMaterial({ color: "#e6c15a", metalness: 1, roughness: 0.2 });
  const mBand = new MeshStandardMaterial({ color: "#f6d23a", roughness: 0.5 });
  const mRed = new MeshStandardMaterial({ color: "#ff2a2a", emissive: "#ff1010", emissiveIntensity: 2.2 });
  const trim = c.gold ? mGold : mAcc;
  const add = (geo: BufferGeometry, m: Material, x = 0, y = 0, z = 0) => { const me = new Mesh(geo, m); me.position.set(x, y, z); g.add(me); return me; };
  const box = (lx: number, ly: number, lz: number, m: Material, x: number, y: number, z: number, rz = 0) => { const me = add(new BoxGeometry(lx, ly, lz), m, x, y, z); me.rotation.z = rz; return me; };
  const tube = (pts: number[][], r: number, m: Material) => add(new TubeGeometry(new CatmullRomCurve3(pts.map((p) => new Vector3(p[0], p[1], p[2]))), 16, r, 8, false), m);

  const fx = L * 0.27, rx = -L * 0.25;      // axles
  const nose = c.nose;
  // floor (plank + edge) and diffuser
  add(loft([{ x: -L * 0.42, w: 0.17, h: 0.012, y: 0.045 }, { x: -L * 0.3, w: 0.27, h: 0.012, y: 0.045 }, { x: -L * 0.05, w: 0.36, h: 0.012, y: 0.045 }, { x: L * 0.12, w: 0.33, h: 0.012, y: 0.045 }, { x: L * 0.2, w: 0.14, h: 0.012, y: 0.05 }], 24, 16), mCarbon);
  { const d = add(new BoxGeometry(L * 0.07, 0.01, 0.3), mBlack, -L * 0.43, 0.07, 0); d.rotation.z = -0.45; }
  // survival cell + nose + engine cover (one loft)
  add(loft([
    { x: L * 0.50 * nose + L * 0.0, w: 0.028, h: 0.022, y: 0.10, p: 2.2 },
    { x: L * 0.42, w: 0.05, h: 0.036, y: 0.112, p: 2.4 },
    { x: L * 0.30, w: 0.075, h: 0.055, y: 0.135, p: 2.6 },
    { x: L * 0.17, w: 0.105, h: 0.08, y: 0.165, p: 2.8, flat: 0.5 },
    { x: L * 0.06, w: 0.135, h: 0.095, y: 0.19, p: 3.2, flat: 0.6 },
    { x: -L * 0.04, w: 0.15, h: 0.105, y: 0.205, p: 3.2, flat: 0.6 },
    { x: -L * 0.14, w: 0.15, h: 0.12, y: 0.22, p: 3.0, flat: 0.6 },
    { x: -L * 0.26, w: 0.11, h: 0.1, y: 0.215, p: 2.8, flat: 0.5 },
    { x: -L * 0.37, w: 0.06, h: 0.07, y: 0.19, p: 2.6 },
    { x: -L * 0.44, w: 0.03, h: 0.035, y: 0.165, p: 2.4 },
  ], 64, 32), mPaint);
  // nose cone tip + chin in carbon
  add(loft([{ x: L * 0.5 * nose + 0.005, w: 0.012, h: 0.012, y: 0.1 }, { x: L * 0.47, w: 0.03, h: 0.024, y: 0.103 }, { x: L * 0.43, w: 0.045, h: 0.03, y: 0.108 }], 8, 16), trim);
  // cockpit rim (dark opening) + headrest
  add(loft([{ x: L * 0.08, w: 0.07, h: 0.02, y: 0.29 }, { x: L * 0.02, w: 0.1, h: 0.025, y: 0.3 }, { x: -L * 0.05, w: 0.1, h: 0.025, y: 0.305 }, { x: -L * 0.08, w: 0.07, h: 0.02, y: 0.305 }], 12, 20), mBlack);
  // airbox / engine cover hump above + behind the driver, with roll hoop intake
  add(loft([
    { x: -L * 0.05, w: 0.04, h: 0.03, y: 0.31 + c.airbox * 0.3 },
    { x: -L * 0.09, w: 0.065, h: 0.075 + c.airbox * 0.35, y: 0.30 + c.airbox * 0.4, p: 2.4 },
    { x: -L * 0.17, w: 0.07, h: 0.07 + c.airbox * 0.3, y: 0.29 + c.airbox * 0.3, p: 2.6 },
    { x: -L * 0.30, w: 0.045, h: 0.045, y: 0.27, p: 2.6 },
    { x: -L * 0.42, w: 0.02, h: 0.02, y: 0.2 },
  ], 32, 24), mPaint);
  { const inlet = add(new CylinderGeometry(0.035, 0.035, 0.01, 20), mBlack, -L * 0.075 + 0.012, 0.33 + c.airbox * 0.55, 0); inlet.rotation.z = Math.PI / 2; inlet.scale.set(1, 1, 1.3); }
  // shark fin
  { const s = new BufferGeometry(); const x0 = -L * 0.16, x1 = -L * 0.42; const y0 = 0.32 + c.airbox * 0.45, yb = 0.24;
    const v = [x0, y0, 0.004, x1, yb + 0.12, 0.004, x1, yb, 0.004, x0, yb + 0.04, 0.004, x0, y0, -0.004, x1, yb + 0.12, -0.004, x1, yb, -0.004, x0, yb + 0.04, -0.004];
    s.setAttribute("position", new Float32BufferAttribute(v, 3)); s.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1]); s.computeVertexNormals(); add(s, mPaint).material = new MeshPhysicalMaterial({ color: paint, metalness: 0.35, roughness: 0.3, clearcoat: 1, side: DoubleSide }); }
  // sidepods with dark inlets
  for (const sz of [1, -1]) {
    const pw = c.pod;
    add(loft([
      { x: L * 0.12, w: 0.03, h: pw * 0.75, y: 0.17, z: sz * 0.205, p: 3.5 },
      { x: L * 0.08, w: 0.07, h: pw * 0.8, y: 0.17, z: sz * 0.225, p: 3.4, flat: 0.8 },
      { x: -L * 0.05, w: 0.075, h: pw * 0.75, y: 0.16, z: sz * 0.23, p: 3.0, flat: 0.8 },
      { x: -L * 0.2, w: 0.055, h: pw * 0.6, y: 0.145, z: sz * 0.205, p: 2.8, flat: 0.7 },
      { x: -L * 0.34, w: 0.02, h: pw * 0.4, y: 0.13, z: sz * 0.15, p: 2.6 },
    ], 32, 24), mPaint);
    const inl = add(new BoxGeometry(0.012, pw * 1.2, 0.11), mBlack, L * 0.125, 0.17, sz * 0.225); void inl;
    // accent stripe along the pod
    add(loft([{ x: L * 0.1, w: 0.004, h: 0.012, y: 0.17 + pw * 0.55, z: sz * 0.27 }, { x: -L * 0.05, w: 0.004, h: 0.012, y: 0.16 + pw * 0.5, z: sz * 0.302 }, { x: -L * 0.2, w: 0.004, h: 0.01, y: 0.145 + pw * 0.35, z: sz * 0.258 }], 16, 8), trim);
    // mirrors
    tube([[L * 0.12, 0.27, sz * 0.12], [L * 0.1, 0.3, sz * 0.2], [L * 0.1, 0.31, sz * 0.24]], 0.006, mCarbon);
    box(0.03, 0.035, 0.07, mPaint, L * 0.1, 0.315, sz * 0.26);
  }
  // halo
  { const halo = new Mesh(new TorusGeometry(0.115, 0.011, 10, 32, Math.PI), c.gold ? mGold : mCarbon); halo.rotation.set(-Math.PI / 2, 0, Math.PI / 2); halo.position.set(-L * 0.04, 0.37, 0); halo.scale.set(1.25, 1, 1); g.add(halo);
    tube([[L * 0.1, 0.27, 0], [L * 0.085, 0.34, 0], [L * 0.025, 0.37, 0], [-L * 0.04 + 0.144, 0.37, 0]], 0.011, c.gold ? mGold : mCarbon);
    for (const sz of [1, -1]) tube([[-L * 0.1, 0.37, sz * 0.112], [-L * 0.12, 0.33, sz * 0.12], [-L * 0.13, 0.29, sz * 0.12]], 0.01, c.gold ? mGold : mCarbon); }
  // front wing: three elements + endplates + nose pylons
  const fwx = L * 0.47 * Math.max(0.95, nose * 0.98); const span = c.wingF / 2;
  box(0.1, 0.01, c.wingF, mCarbon, fwx + 0.02, 0.035, 0, 0.05);
  box(0.075, 0.009, c.wingF * 0.96, trim, fwx - 0.04, 0.055, 0, 0.22);
  box(0.06, 0.008, c.wingF * 0.92, mPaint, fwx - 0.085, 0.078, 0, 0.42);
  for (const sz of [1, -1]) { const ep = box(0.16, 0.09, 0.008, mPaint, fwx - 0.03, 0.065, sz * span); void ep; box(0.03, 0.06, 0.01, trim, fwx + 0.03, 0.06, sz * (span - 0.004)); }
  for (const sz of [1, -1]) box(0.07, 0.06, 0.008, mCarbon, fwx - 0.02, 0.075, sz * 0.03);
  // rear wing: main plane + DRS flap, tall endplates, swan neck, beam wing, rain light
  const rwx = -L * 0.45, rwy = c.rearH, rs = c.wingR / 2;
  box(0.13, 0.014, c.wingR, mCarbon, rwx, rwy, 0, 0.12);
  box(0.09, 0.012, c.wingR, mPaint, rwx - 0.005, rwy + 0.055, 0, 0.45);
  for (const sz of [1, -1]) { box(0.2, rwy - 0.12, 0.01, mPaint, rwx + 0.01, (rwy + 0.14) / 2 + 0.03, sz * rs); box(0.2, 0.03, 0.012, trim, rwx + 0.01, rwy + 0.075, sz * rs); }
  tube([[-L * 0.36, 0.24, 0], [-L * 0.42, 0.32, 0], [rwx + 0.02, rwy + 0.02, 0]], 0.012, mCarbon);
  box(0.06, 0.01, c.wingR * 0.85, mCarbon, rwx + 0.04, 0.2, 0, 0.2);
  box(0.012, 0.04, 0.03, mRed, -L * 0.47, 0.155, 0);
  // decals: number on the nose, REBEL on the rear wing (seen from behind) and the endplates
  const dec = (tex: CanvasTexture, w: number, h: number, x: number, y: number, z: number, rx: number, ry: number) => { const m = new Mesh(new PlaneGeometry(w, h), new MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, metalness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0, "YXZ"); g.add(m); return m; };
  dec(textTex(num, "#ffffff", null, 256, 128), 0.09, 0.045, L * 0.33, 0.19 + 0.0, 0, -Math.PI / 2 + 0.28, -Math.PI / 2);
  dec(textTex("REBEL", "#ffffff", null), 0.24, 0.06, rwx - 0.055, rwy + 0.083, 0, 0, -Math.PI / 2).rotation.set(0, -Math.PI / 2, 0);
  for (const sz of [1, -1]) dec(textTex("REBEL", accent === "#ffffff" ? "#111" : "#ffffff", null), 0.16, 0.04, rwx + 0.01, rwy - 0.06, sz * (rs + 0.0062), 0, sz > 0 ? 0 : Math.PI);
  for (const sz of [1, -1]) dec(textTex(num, "#ffffff", null, 256, 128), 0.08, 0.04, -L * 0.2, 0.3, sz * 0.062, 0, sz > 0 ? 0 : Math.PI);
  // wheels: rounded tyres with a coloured sidewall band, dark rims with an accent lip, suspension arms
  const wheel = (x: number, sz: number, R: number, wd: number) => {
    const prof: Vector2[] = []; const rr = wd * 0.32;
    for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2); prof.push(new Vector2(R - rr + Math.cos(a) * rr, -wd / 2 + rr + Math.sin(a) * rr)); }
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); prof.push(new Vector2(R - rr + Math.cos(a) * rr, wd / 2 - rr + Math.sin(a) * rr)); }
    prof.unshift(new Vector2(R * 0.62, -wd / 2)); prof.push(new Vector2(R * 0.62, wd / 2));
    const z = sz * (0.33 + wd / 2);
    const t = add(new LatheGeometry(prof, 40), mTyre, x, R, z); t.rotation.x = Math.PI / 2;
    for (const side of [1, -1]) { const band = add(new TorusGeometry(R * 0.8, R * 0.035, 6, 40), mBand, x, R, z + side * (wd / 2 + 0.001)); void band;
      const rim = add(new CylinderGeometry(R * 0.6, R * 0.6, 0.004, 32), mRim, x, R, z + side * (wd / 2 - 0.004)); rim.rotation.x = Math.PI / 2;
      const lip = add(new TorusGeometry(R * 0.6, R * 0.03, 6, 32), trim, x, R, z + side * (wd / 2 - 0.002)); void lip;
      const nut = add(new CylinderGeometry(R * 0.12, R * 0.12, 0.012, 12), c.gold ? mGold : mAcc, x, R, z + side * (wd / 2)); nut.rotation.x = Math.PI / 2; }
    for (const [dx, dy] of [[0.05, 0.03], [-0.05, 0.03], [0.04, -0.03]]) tube([[x + dx, R + dy, sz * 0.1], [x + dx * 0.4, R + dy * 0.6, z - sz * wd * 0.4]], 0.007, mCarbon);
  };
  for (const sz of [1, -1]) { wheel(fx, sz, c.tyreF, 0.12); wheel(rx, sz, c.tyreR, 0.16); }
  g.scale.setScalar(u);
  return { g, seatY: 0.03 * u, seatX: -L * 0.0 * u };
}

function Rig({ fid, kid, paint, accent, num }: { fid: string; kid: string; paint: string; accent: string; num: string }) {
  const gltf = useGLTF(`/faction-wars/characters/${fid}/${fid}.glb`) as any;
  const idle = useFBX(`/faction-wars/characters/${fid}/idle.fbx`) as any;
  const { gl, scene, camera } = useThree();
  const ref = useRef<Object3D | null>(null);
  useEffect(() => {
    const pm = new PMREMGenerator(gl); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    const root = new Group(); scene.add(root); ref.current = root;
    const s = clone(gltf.scene);
    s.traverse((o: any) => { if (o.isMesh || o.isSkinnedMesh) { o.frustumCulled = false; const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m: any) => { if (m) m.side = DoubleSide; }); } });
    const bones: Record<string, any> = {}; s.traverse((o: any) => { if (o.isBone) bones[o.name.replace("mixamorig_", "").replace("mixamorig", "")] = o; });
    const retarget = (clip: any) => { const c = clip.clone(); c.tracks = c.tracks.map((t: any) => { t.name = t.name.replace(/^mixamorig(?!_)([A-Z][^.]*)(\..+)$/, "mixamorig_$1$2"); return t; }).filter((t: any) => t.name.endsWith(".quaternion")); return c; };
    const mixer = new AnimationMixer(s); const action = mixer.clipAction(retarget(idle.animations[0])); action.play(); action.time = 0.2; mixer.update(0); s.updateMatrixWorld(true);
    const box = new Box3().setFromObject(s); const size = new Vector3(); box.getSize(size); const H = size.y;
    const { g: car, seatY, seatX } = buildF1(H, kid, paint, accent, num);
    root.add(car); root.add(s);
    (window as any).__H = H;
    (window as any).__pose = (o: any = {}) => {
      // F1 driving position: lying back, legs straight into the nose, hands up on the wheel
      const rot = (b: string, x: number, y: number, z: number) => { const bb = bones[b]; if (bb) bb.rotation.set(bb.rotation.x + x, bb.rotation.y + y, bb.rotation.z + z); };
      action.stop(); action.play(); action.time = 0.2; mixer.update(0);
      const P = { thigh: -1.45, shin: 0.3, arm: -0.55, armZ: 1.05, fore: -1.0, lean: -0.12, ...o };
      rot("LeftUpLeg", P.thigh, 0, 0.08); rot("RightUpLeg", P.thigh, 0, -0.08); rot("LeftLeg", P.shin, 0, 0); rot("RightLeg", P.shin, 0, 0);
      rot("LeftArm", P.arm, 0, P.armZ); rot("RightArm", P.arm, 0, -P.armZ); rot("LeftForeArm", P.fore, 0, 0); rot("RightForeArm", P.fore, 0, 0);
      rot("Spine", P.lean, 0, 0); rot("Head", 0.25, 0, 0); if (o.head) rot("Head", o.head[0], o.head[1], o.head[2]);
      s.rotation.set(0, Math.PI / 2, 0);
      s.updateMatrixWorld(true);
      const hp = new Vector3(); bones.Hips.getWorldPosition(hp);
      s.position.set(seatX - hp.x, seatY - hp.y + (o.dy || 0) * H, -hp.z); s.updateMatrixWorld(true);
      return [H, seatY, seatX];
    };
    (window as any).__yaw = (a: number) => { root.rotation.set(0, a, 0); root.updateMatrixWorld(true); };
    (window as any).__cam = (hMul: number, pitch = 0.36) => {
      root.rotation.set(0, 0, 0); root.updateMatrixWorld(true);
      const bb = new Box3().setFromObject(root); const sz = new Vector3(); bb.getSize(sz);
      const h = hMul > 2 ? (window as any).__H * hMul : Math.max(sz.x, sz.y, sz.z) * hMul;   // > 2: absolute, in rider heights (same scale for every chassis)
      const cam = camera as any; cam.left = -h * 0.5; cam.right = h * 0.5; cam.top = h * 0.5; cam.bottom = -h * 0.5; cam.near = -1000; cam.far = 1000; cam.updateProjectionMatrix();
      const cy = hMul > 2 ? (window as any).__H * 0.25 : bb.min.y + sz.y * 0.5; cam.position.set(0, cy + Math.sin(pitch) * 10, Math.cos(pitch) * 10); cam.lookAt(0, cy, 0); cam.updateMatrixWorld(true);
      return [sz.x, sz.y, sz.z, bb.min.y];
    };
    (window as any).__shot = () => { gl.render(scene, camera); return gl.domElement.toDataURL("image/png"); };
    (window as any).__ready = true;
    return () => { scene.remove(root); };
  }, [gltf, idle, gl, scene, camera, kid, paint, accent, num]);
  return null;
}

export default function Dev() {
  const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const fid = q?.get("f") || "samurai"; const kid = q?.get("k") || "soldier"; const paint = "#" + (q?.get("p") || "c0392b"); const accent = "#" + (q?.get("a") || "ffd166"); const num = q?.get("n") || "7";
  return (
    <div style={{ width: 512, height: 512, background: "#000" }}>
      <Canvas orthographic dpr={2} gl={{ preserveDrawingBuffer: true, alpha: true, antialias: true }} camera={{ position: [0, 2, 10], zoom: 1 }} frameloop="demand" style={{ width: 512, height: 512, background: "transparent" }}>
        <ambientLight intensity={0.5} />
        <hemisphereLight args={["#ffffff", "#5a4a40", 0.9]} />
        <directionalLight position={[3, 8, 6]} intensity={2.4} />
        <directionalLight position={[-4, 3, -4]} intensity={1.0} color="#ffd8b8" />
        <Rig fid={fid} kid={kid} paint={paint} accent={accent} num={num} />
      </Canvas>
    </div>
  );
}
