// components/fight/weapons.ts — procedural weapons and props (no downloads).
// Convention: origin = where the hand grips, +Y = toward the tip / business end, +Z = the cutting edge / front face.
import * as THREE from "three";
import type { WeaponId } from "./moves";

const std = (color: string, metal = 0.2, rough = 0.6, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, ...extra });
const STEEL = () => std("#d9e2ea", 0.95, 0.22);
const WRAP = (c = "#2a1d18") => std(c, 0.1, 0.8);
const GOLD = () => std("#e8b64a", 0.9, 0.3);
const WOOD = (c = "#6b4423") => std(c, 0.05, 0.75);

function mesh(g: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0]) {
  const o = new THREE.Mesh(g, m); o.position.set(...pos); o.rotation.set(...rot); o.castShadow = true; return o;
}
/** a curved single-edged blade along +Y, edge toward +Z */
function curvedBlade(len: number, width: number, curve: number, mat: THREE.Material) {
  const s = new THREE.Shape(); const n = 14;
  const spine: [number, number][] = [], edge: [number, number][] = [];
  for (let i = 0; i <= n; i++) { const u = i / n; const y = u * len; const bend = curve * u * u; const w = width * (1 - Math.pow(u, 6) * 0.9); spine.push([-w * 0.35 - bend, y]); edge.push([w * 0.65 - bend, y]); }
  edge[n] = [edge[n][0] - width * 0.4, len + width * 0.6];
  s.moveTo(spine[0][0], spine[0][1]); for (const p of spine) s.lineTo(p[0], p[1]); for (let i = n; i >= 0; i--) s.lineTo(edge[i][0], edge[i][1]); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 1 });
  g.translate(0, 0, -0.004); g.rotateY(-Math.PI / 2); // shape x → world z (edge forward)
  return mesh(g, mat);
}
function tsuba(r: number, mat = GOLD()) { return mesh(new THREE.CylinderGeometry(r, r, 0.012, 20), mat); }
function handle(len: number, r: number, mat: THREE.Material, y0 = -0.02) { const m = mesh(new THREE.CylinderGeometry(r, r * 1.05, len, 10), mat); m.position.y = y0 - len / 2 + 0.06; return m; }

function katana(scale = 1) {
  const g = new THREE.Group();
  const blade = curvedBlade(0.78 * scale, 0.034, 0.05, STEEL()); blade.position.y = 0.09; g.add(blade);
  const t = tsuba(0.042); t.position.y = 0.085; g.add(t);
  g.add(handle(0.26 * scale, 0.017, WRAP()));
  const hamon = mesh(new THREE.BoxGeometry(0.002, 0.7 * scale, 0.006), std("#ffffff", 1, 0.1, { emissive: new THREE.Color("#9fc7ff"), emissiveIntensity: 0.25 }), [0, 0.09 + 0.36 * scale, 0.016]); g.add(hamon);
  // the scabbard (saya): shown while the sword is sheathed
  const saya = new THREE.Group(); const sm = std("#14100e", 0.3, 0.35);
  const sb = curvedBlade(0.8 * scale, 0.05, 0.05, sm); sb.scale.set(4.5, 1, 1.15); sb.position.y = 0.09; saya.add(sb);
  const koi = mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 12), GOLD()); koi.position.y = 0.11; koi.scale.z = 0.7; saya.add(koi);
  const cord = mesh(new THREE.TorusGeometry(0.03, 0.007, 6, 14), std("#7a1d1d", 0, 0.8)); cord.position.set(0, 0.2, -0.02); saya.add(cord);
  saya.visible = false; g.add(saya); g.userData.saya = saya;
  g.userData.tip = 0.09 + 0.78 * scale; g.userData.grip2 = -0.115 * Math.max(0.8, scale); return g;
}
function polearm(len: number, head: "yari" | "naginata", shaftCol = "#3b2416") {
  const g = new THREE.Group();
  const shaft = mesh(new THREE.CylinderGeometry(0.016, 0.018, len, 8), WOOD(shaftCol)); shaft.position.y = len / 2 - 0.55; g.add(shaft);
  const top = len - 0.55;
  if (head === "yari") {
    const tip = mesh(new THREE.ConeGeometry(0.03, 0.32, 4), STEEL()); tip.position.y = top + 0.16; g.add(tip);
    const col = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.06, 8), GOLD()); col.position.y = top; g.add(col);
    const tassel = mesh(new THREE.ConeGeometry(0.05, 0.1, 8), std("#c0392b", 0, 0.9)); tassel.position.y = top - 0.06; tassel.rotation.x = Math.PI; g.add(tassel);
  } else {
    const b = curvedBlade(0.5, 0.05, 0.08, STEEL()); b.position.y = top; g.add(b);
    const t = tsuba(0.038); t.position.y = top; g.add(t);
  }
  const butt = mesh(new THREE.CylinderGeometry(0.02, 0.012, 0.06, 8), std("#8a6a3a", 0.8, 0.4)); butt.position.y = -0.55; g.add(butt);
  g.userData.tip = top + 0.32; g.userData.grip2 = 0.42; return g;
}
function staff(len: number, rings = false) {
  const g = new THREE.Group();
  const s = mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 8), WOOD("#5a3a1e")); s.position.y = len / 2 - len * 0.35; g.add(s);
  for (const y of [len * 0.65 - 0.02, -len * 0.35 + 0.02]) { const c = mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.06, 8), GOLD()); c.position.y = y; g.add(c); }
  if (rings) {
    const top = len * 0.65;
    const loop = mesh(new THREE.TorusGeometry(0.09, 0.008, 6, 24), GOLD()); loop.position.y = top + 0.08; loop.rotation.y = Math.PI / 2; g.add(loop);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const r = mesh(new THREE.TorusGeometry(0.025, 0.004, 5, 12), GOLD()); r.position.set(0, top + 0.08 + Math.sin(a) * 0.09, Math.cos(a) * 0.09); g.add(r); }
  }
  g.userData.tip = len * 0.65; g.userData.grip2 = 0.42; return g;
}
function kanabo() {
  const g = new THREE.Group();
  g.add(handle(0.3, 0.02, WRAP("#1a1a1a")));
  const club = mesh(new THREE.CylinderGeometry(0.075, 0.035, 0.85, 8), std("#2b2b30", 0.6, 0.5)); club.position.y = 0.48; g.add(club);
  for (let i = 0; i < 28; i++) { const y = 0.2 + (i % 7) * 0.12, a = Math.floor(i / 7) * (Math.PI / 2) + (i % 2) * 0.4; const r = 0.04 + (y - 0.05) * 0.045;
    const st = mesh(new THREE.ConeGeometry(0.014, 0.05, 5), std("#a0a4ab", 0.9, 0.3)); st.position.set(Math.sin(a) * r, y, Math.cos(a) * r); st.lookAt(Math.sin(a) * 5, y, Math.cos(a) * 5); st.rotateX(Math.PI / 2); g.add(st); }
  g.userData.tip = 0.9; g.userData.grip2 = -0.12; return g;
}
function ono() {
  const g = new THREE.Group();
  const s = mesh(new THREE.CylinderGeometry(0.018, 0.02, 1.0, 8), WOOD()); s.position.y = 0.3; g.add(s);
  const sh = new THREE.Shape(); sh.moveTo(0, -0.08); sh.quadraticCurveTo(0.28, -0.2, 0.3, 0.05); sh.quadraticCurveTo(0.28, 0.28, 0, 0.16); sh.closePath();
  const head = mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 }), STEEL());
  head.geometry.translate(0, 0, -0.01); head.rotation.y = -Math.PI / 2; head.position.y = 0.68; g.add(head);
  g.userData.tip = 0.8; return g;
}
function yumi() {
  // bow held at the grip (lower third), limbs along ±Y, string toward -Z
  const g = new THREE.Group();
  const pts: THREE.Vector3[] = []; for (let i = 0; i <= 24; i++) { const u = i / 24; const y = -0.62 + u * 1.9; const z = 0.12 * Math.sin(u * Math.PI) - 0.04 * Math.sin(u * Math.PI * 3); pts.push(new THREE.Vector3(0, y, z)); }
  const curve = new THREE.CatmullRomCurve3(pts);
  g.add(mesh(new THREE.TubeGeometry(curve, 40, 0.014, 6), std("#3a1f12", 0.1, 0.6)));
  const str = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pts[0], pts[24]]), new THREE.LineBasicMaterial({ color: "#f5f0e0" })); g.add(str); g.userData.string = str;
  const grip = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), WRAP("#7a1d1d")); grip.position.set(0, 0, 0.12 * Math.sin((0.62 / 1.9) * Math.PI)); g.add(grip);
  // origin = the grip (the hand closes on the stave, not the string); the string sits behind it
  const gz = grip.position.z; g.children.forEach((c) => (c.position.z -= gz));
  str.geometry.setFromPoints([pts[0], pts[0].clone().lerp(pts[24], 0.5), pts[24]]);
  g.userData.stringEnds = [pts[0].clone().setZ(pts[0].z - gz), pts[24].clone().setZ(pts[24].z - gz)];
  g.userData.tip = 1.28; return g;
}
function arrow(glow?: string) {
  const g = new THREE.Group();
  const s = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.9, 5), WOOD("#c9a46a")); s.position.y = 0; g.add(s);
  const tip = mesh(new THREE.ConeGeometry(0.016, 0.07, 4), glow ? std(glow, 0.5, 0.3, { emissive: new THREE.Color(glow), emissiveIntensity: 2 }) : STEEL()); tip.position.y = 0.48; g.add(tip);
  for (let i = 0; i < 3; i++) { const f = mesh(new THREE.PlaneGeometry(0.035, 0.12), std("#f4f1ea", 0, 0.9, { side: THREE.DoubleSide })); f.position.y = -0.38; f.rotation.y = (i / 3) * Math.PI; f.position.x = Math.sin((i / 3) * Math.PI) * 0.02; g.add(f); }
  g.children.forEach((c) => (c.position.y += 0.42)); // origin at the nock
  g.userData.tip = 0.92; return g;
}
function shuriken(col = "#cfd6dd") {
  const s = new THREE.Shape(); const n = 4;
  for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * Math.PI * 2; const r = i % 2 ? 0.035 : 0.11; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) s.lineTo(x, y); else s.moveTo(x, y); }
  s.closePath(); const hole = new THREE.Path(); hole.absarc(0, 0, 0.018, 0, Math.PI * 2, true); s.holes.push(hole);
  const g = new THREE.Group(); const m = mesh(new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 }), std(col, 0.95, 0.25));
  m.geometry.translate(0, 0, -0.004); g.add(m); g.userData.tip = 0.1; return g;
}
function kunai() {
  const g = new THREE.Group();
  const b = mesh(new THREE.ConeGeometry(0.035, 0.2, 4), STEEL()); b.position.y = 0.12; b.scale.z = 0.3; g.add(b);
  g.add(handle(0.12, 0.012, WRAP()));
  const ring = mesh(new THREE.TorusGeometry(0.025, 0.006, 6, 14), STEEL()); ring.position.y = -0.11; g.add(ring);
  g.userData.tip = 0.22; return g;
}
function tessen(col: string) {
  const g = new THREE.Group();
  const ribs = 11, R = 0.42;
  const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.absarc(0, 0, R, Math.PI * 0.18, Math.PI * 0.82, false); shape.lineTo(0, 0);
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.1, Math.PI * 0.82, Math.PI * 0.18, true);
  const paper = mesh(new THREE.ShapeGeometry(shape, 24), std(col, 0.1, 0.7, { side: THREE.DoubleSide, emissive: new THREE.Color(col), emissiveIntensity: 0.15 }));
  paper.rotation.y = Math.PI / 2; g.add(paper);
  for (let i = 0; i < ribs; i++) { const a = Math.PI * 0.18 + (i / (ribs - 1)) * Math.PI * 0.64; const r = mesh(new THREE.BoxGeometry(0.006, R, 0.012), std("#1c1c1c", 0.6, 0.4)); r.position.set(0, Math.sin(a) * R / 2, Math.cos(a) * R / 2); r.rotation.x = -(a - Math.PI / 2); g.add(r); }
  const sun = mesh(new THREE.CircleGeometry(0.09, 20), std("#d01c1c", 0, 0.6, { side: THREE.DoubleSide })); sun.rotation.y = Math.PI / 2; sun.position.set(0.002, 0.25, 0); g.add(sun);
  g.userData.tip = R; return g;
}
let scrollTex: THREE.Texture | null = null;
function scroll(flip = false) {   // flip: the mirrored (enemy) side, so the paper still opens toward the body
  const g = new THREE.Group();
  if (!scrollTex && typeof document !== "undefined") {
    const c = document.createElement("canvas"); c.width = 256; c.height = 192; const x = c.getContext("2d")!;
    x.fillStyle = "#efe2bd"; x.fillRect(0, 0, 256, 192); x.fillStyle = "#1b1410"; x.font = "bold 46px serif"; x.textAlign = "center";
    ["勅", "命", "令"].forEach((ch, i) => x.fillText(ch, 200 - i * 70, 110)); x.fillStyle = "#b3121a"; x.fillRect(22, 132, 34, 34);
    scrollTex = new THREE.CanvasTexture(c); scrollTex.colorSpace = THREE.SRGBColorSpace;
  }
  // a handscroll held by its outer rod: the rods run along the handle axis (Y), the paper opens back toward the body (-X) facing +Z
  const paper = mesh(new THREE.PlaneGeometry(0.42, 0.3), std("#ffffff", 0, 0.9, { side: THREE.DoubleSide, map: scrollTex || undefined })); const sx = flip ? -1 : 1; paper.position.x = -0.24 * sx; g.add(paper);
  for (const x of [-0.02 * sx, -0.46 * sx]) { const r = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.38, 8), WOOD("#3a1f12")); r.position.x = x; g.add(r);
    for (const y of [-0.2, 0.2]) { const cap = mesh(new THREE.SphereGeometry(0.024, 8, 6), GOLD()); cap.position.set(x, y, 0); g.add(cap); } }
  g.userData.paper = paper; g.userData.tip = 0.2; return g;
}
function cutlass() {
  const g = new THREE.Group();
  const blade = curvedBlade(0.62, 0.05, 0.1, STEEL()); blade.position.y = 0.08; g.add(blade);
  const guard = mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 14, Math.PI), GOLD()); guard.position.set(0, 0.0, 0.02); guard.rotation.y = Math.PI / 2; g.add(guard);
  g.add(handle(0.13, 0.016, WRAP("#3a2a1a")));
  g.userData.tip = 0.7; return g;
}
function bomb() {
  const g = new THREE.Group();
  const b = mesh(new THREE.SphereGeometry(0.11, 18, 14), std("#1b1b1f", 0.4, 0.5)); b.position.y = 0.1; g.add(b);
  const cap = mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.04, 10), std("#6b6b70", 0.8, 0.4)); cap.position.y = 0.22; g.add(cap);
  const fuse = mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.08, 5), std("#c9a46a", 0, 0.9)); fuse.position.set(0.01, 0.27, 0); fuse.rotation.z = 0.3; g.add(fuse);
  g.userData.tip = 0.3; return g;
}
function keg() {
  // a small powder keg: wooden staves, two iron hoops, a fuse on top — held from underneath
  const g = new THREE.Group(); const wood = WOOD("#7a4a22"); const iron = std("#2c2c30", 0.8, 0.45);
  const body = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.3, 16), wood); body.position.y = 0.17; body.scale.set(1, 1, 1); g.add(body);
  const belly = mesh(new THREE.SphereGeometry(0.15, 16, 10), wood); belly.position.y = 0.17; belly.scale.set(1, 0.9, 1); g.add(belly);
  for (const y of [0.07, 0.27]) { const h = mesh(new THREE.TorusGeometry(0.14, 0.012, 6, 20), iron); h.rotation.x = Math.PI / 2; h.position.y = y; g.add(h); }
  const lid = mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.012, 16), WOOD("#5a3416")); lid.position.y = 0.325; g.add(lid);
  const fuse = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 5), std("#c9a46a", 0, 0.9)); fuse.position.set(0.02, 0.37, 0); fuse.rotation.z = 0.35; g.add(fuse);
  g.userData.tip = 0.42; return g;
}
function gourd() {
  const g = new THREE.Group(); const m = std("#c8862a", 0.1, 0.6);
  const a = mesh(new THREE.SphereGeometry(0.07, 14, 10), m); a.position.y = 0.05; g.add(a);
  const b = mesh(new THREE.SphereGeometry(0.05, 14, 10), m); b.position.y = 0.15; g.add(b);
  const cork = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.04, 8), WOOD()); cork.position.y = 0.21; g.add(cork);
  g.userData.tip = 0.22; return g;
}
function conch() {
  const g = new THREE.Group(); const m = std("#f2e3cf", 0.1, 0.5);
  const body = mesh(new THREE.ConeGeometry(0.08, 0.3, 14), m); body.position.y = 0.1; body.rotation.x = Math.PI; g.add(body);
  const lip = mesh(new THREE.TorusGeometry(0.06, 0.02, 8, 16), std("#e8a98a", 0.1, 0.5)); lip.position.y = 0.24; lip.rotation.x = Math.PI / 2; g.add(lip);
  g.userData.tip = 0.26; return g;
}
function teppo() {
  const g = new THREE.Group();
  const barrel = mesh(new THREE.CylinderGeometry(0.018, 0.02, 1.0, 10), std("#3a3a40", 0.8, 0.35)); barrel.position.y = 0.55; g.add(barrel);
  const stock = mesh(new THREE.BoxGeometry(0.05, 0.5, 0.07), WOOD("#4a2a14")); stock.position.y = 0.1; g.add(stock);
  g.userData.tip = 1.05; g.userData.grip2 = 0.42; return g;
}
function orb(col: string) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: col })));
  const halo = mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); g.add(halo);
  g.userData.tip = 0; return g;
}

export function makeWeapon(id: WeaponId, color = "#ffffff", flip = false): THREE.Group {
  const g = makeWeapon0(id, color, flip); g.userData.id = id; return g;
}
function makeWeapon0(id: WeaponId, color: string, flip: boolean): THREE.Group {
  switch (id) {
    case "katana": return katana();
    case "wakizashi": return katana(0.68);
    case "yari": return polearm(2.3, "yari");
    case "naginata": return polearm(2.0, "naginata", "#1a1a2a");
    case "bo": return staff(1.9);
    case "shakujo": return staff(1.9, true);
    case "kanabo": return kanabo();
    case "ono": return ono();
    case "yumi": return yumi();
    case "arrow": return arrow(color);
    case "shuriken": return shuriken();
    case "kunai": return kunai();
    case "tessen": return tessen(color);
    case "scroll": return scroll(flip);
    case "cutlass": return cutlass();
    case "bomb": return bomb();
    case "keg": return keg();
    case "gourd": return gourd();
    case "conch": return conch();
    case "teppo": return teppo();
    case "orb": return orb(color);
  }
}

/** place a weapon at a hand, blade along `dir`, edge toward `up` (world vectors) */
const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
export function placeWeapon(w: THREE.Object3D, at: THREE.Vector3, dir: THREE.Vector3, up: THREE.Vector3) {
  _y.copy(dir).normalize(); _z.copy(up).sub(_y.clone().multiplyScalar(up.dot(_y)));
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).sub(_y.clone().multiplyScalar(_y.z));
  _z.normalize(); _x.crossVectors(_y, _z).normalize();
  _m.makeBasis(_x, _y, _z); w.quaternion.setFromRotationMatrix(_m); w.position.copy(at);
}
export function weaponTip(w: THREE.Object3D, out = new THREE.Vector3()) { return out.set(0, (w.userData.tip as number) || 0.5, 0).applyQuaternion(w.quaternion).add(w.position); }
