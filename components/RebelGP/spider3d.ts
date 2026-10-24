// components/RebelGP/spider3d.ts
// The track spiders as real creatures: hairy banded legs (femur + tibia + tarsus) placed by two-bone IK on a tetrapod gait
// (legs L1 R2 L3 R4 step while the others push), feet planted on the ground and advanced by the distance actually walked,
// a patterned abdomen that breathes, a cephalothorax with a cluster of glossy eyes, twitching fangs and pedipalps. The body
// turns to face where it's walking. All leg segments of all spiders are two instanced meshes.
import * as THREE from "three";

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function tex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h; draw(cv.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
function fur(c: CanvasRenderingContext2D, w: number, h: number, base: string, n: number) {
  c.fillStyle = base; c.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) { const x = Math.random() * w, y = Math.random() * h, l = 2 + Math.random() * 6; const a = Math.random() * 0.3; c.strokeStyle = Math.random() < 0.5 ? `rgba(0,0,0,${0.25 + a})` : `rgba(210,170,120,${0.08 + a * 0.4})`; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (Math.random() - 0.5) * 2, y + l); c.stroke(); }
}
let mats: { body: THREE.MeshStandardMaterial; abdomen: THREE.MeshStandardMaterial; leg: THREE.MeshStandardMaterial; eye: THREE.MeshPhysicalMaterial; fang: THREE.MeshStandardMaterial } | null = null;
function materials() {
  if (mats) return mats;
  const bodyT = tex(256, 256, (c, w, h) => fur(c, w, h, "#2a1d16", 5000));
  const abdT = tex(512, 256, (c, w, h) => {
    fur(c, w, h, "#24170f", 9000);
    // dorsal pattern: a pale chevron stripe down the back with dark edges (wolf-spider / tarantula look)
    c.globalAlpha = 0.85; for (let i = 0; i < 6; i++) { const x = w * (0.18 + i * 0.12), y = h / 2; c.fillStyle = i % 2 ? "#8a5a2c" : "#a8723a"; c.beginPath(); c.moveTo(x - 26, y - 34 + i * 2); c.lineTo(x + 10, y); c.lineTo(x - 26, y + 34 - i * 2); c.lineTo(x - 14, y); c.closePath(); c.fill(); }
    c.fillStyle = "rgba(170,40,20,0.7)"; c.beginPath(); c.ellipse(w * 0.82, h / 2, 26, 12, 0, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
  });
  const legT = tex(64, 256, (c, w, h) => { fur(c, w, h, "#2b1e16", 1600); c.fillStyle = "rgba(190,140,90,0.55)"; for (const y of [0.02, 0.48, 0.96]) c.fillRect(0, y * h - 6, w, 12); });
  mats = {
    body: new THREE.MeshStandardMaterial({ map: bodyT, roughness: 0.82, metalness: 0.0 }),
    abdomen: new THREE.MeshStandardMaterial({ map: abdT, roughness: 0.75, metalness: 0.0 }),
    leg: new THREE.MeshStandardMaterial({ map: legT, roughness: 0.85 }),
    eye: new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.05, clearcoat: 1, metalness: 0.3, emissive: 0x400000, emissiveIntensity: 0.6 }),
    fang: new THREE.MeshStandardMaterial({ color: 0x120a08, roughness: 0.3, metalness: 0.2 }),
  };
  return mats;
}

// leg layout (local: +x forward, +z left, +y up): hip on the cephalothorax rim, resting foot far out on the ground
const LEGS = [
  { ang: 0.55, reach: 15.5, a: 9.0, b: 11.5 },   // front (longest, reaching ahead)
  { ang: 1.15, reach: 13.5, a: 8.2, b: 10.0 },
  { ang: 1.85, reach: 13.0, a: 8.0, b: 9.6 },
  { ang: 2.45, reach: 14.5, a: 8.8, b: 10.8 },   // back
];
type Leg = { hip: THREE.Vector3; rest: THREE.Vector3; foot: THREE.Vector3; a: number; b: number; group: number; side: number };
export type Spider = { root: THREE.Group; body: THREE.Group; abdomen: THREE.Mesh; fangs: THREE.Group[]; palps: THREE.Group[]; legs: Leg[]; phase: number; heading: number; last: THREE.Vector2 | null; idx: number; walk: number };

export class SpiderKit {
  femur: THREE.InstancedMesh; tibia: THREE.InstancedMesh; count = 0; spiders: Spider[] = []; max: number;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private up = v3(0, 1, 0);
  constructor(scene: THREE.Scene, max: number, castShadow: boolean) {
    this.max = Math.max(1, max); const M = materials();
    // unit segment along +y from 0 to 1, tapered; scaled per instance
    const fem = new THREE.CylinderGeometry(0.62, 0.85, 1, 8, 1); fem.translate(0, 0.5, 0);
    const tib = new THREE.CylinderGeometry(0.2, 0.62, 1, 8, 1); tib.translate(0, 0.5, 0);
    this.femur = new THREE.InstancedMesh(fem, M.leg, this.max * 8); this.tibia = new THREE.InstancedMesh(tib, M.leg, this.max * 8);
    for (const im of [this.femur, this.tibia]) { im.castShadow = castShadow; im.frustumCulled = false; im.count = 0; scene.add(im); }
  }
  make(scene: THREE.Scene, castShadow: boolean): Spider {
    const M = materials(); const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
    const ceph = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), M.body); ceph.scale.set(3.6, 2.0, 3.1); ceph.position.set(2.2, 6.2, 0); body.add(ceph);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 2, 8), M.body); ped.rotation.z = Math.PI / 2; ped.position.set(-1.6, 6.3, 0); body.add(ped);
    const abd = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), M.abdomen); abd.scale.set(6.2, 4.4, 4.9); abd.position.set(-7.2, 7.4, 0); abd.rotation.z = 0.18; body.add(abd);
    // spinnerets
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.6, 6), M.body); sp.rotation.z = Math.PI / 2; sp.position.set(-13.2, 6.6, 0); body.add(sp);
    // eyes: two big front ones, a row of four, two on top
    const eyes: [number, number, number, number][] = [[5.55, 7.0, 0.75, 0.62], [5.55, 7.0, -0.75, 0.62], [5.2, 7.7, 1.55, 0.36], [5.2, 7.7, -1.55, 0.36], [5.45, 6.4, 1.6, 0.32], [5.45, 6.4, -1.6, 0.32], [4.4, 8.15, 0.8, 0.42], [4.4, 8.15, -0.8, 0.42]];
    for (const [x, y, z, r] of eyes) { const e = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), M.eye); e.position.set(x, y, z); body.add(e); }
    // chelicerae with fangs, and pedipalps
    const fangs: THREE.Group[] = [], palps: THREE.Group[] = [];
    for (const s of [1, -1]) {
      const f = new THREE.Group(); f.position.set(5.4, 5.6, s * 0.75); const ch = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), M.body); ch.scale.set(0.9, 1.4, 0.7); ch.position.y = -0.9; f.add(ch);
      const fg = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.6, 6), M.fang); fg.position.set(0.3, -2.4, -s * 0.2); fg.rotation.z = 0.5; f.add(fg); body.add(f); fangs.push(f);
      const p = new THREE.Group(); p.position.set(5.0, 6.0, s * 1.7); const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 3, 6), M.leg); p1.position.y = 1.5; p.add(p1); const p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.35, 2.2, 6), M.leg); p2.position.set(0.9, 3.4, 0); p2.rotation.z = -1.0; p.add(p2); p.rotation.set(s * -0.4, 0, -1.2); body.add(p); palps.push(p);
    }
    for (const m of [ceph, abd, ped, sp]) m.castShadow = castShadow;
    const legs: Leg[] = [];
    LEGS.forEach((L, i) => { for (const side of [1, -1]) {
      const hip = v3(2.2 + Math.cos(L.ang) * 2.6, 6.0, side * Math.sin(L.ang) * 2.4);
      const rest = v3(2.2 + Math.cos(L.ang) * L.reach, 0, side * Math.sin(L.ang) * L.reach);
      // tetrapod gait: L1 R2 L3 R4 together, R1 L2 R3 L4 together
      const group = (i + (side > 0 ? 0 : 1)) % 2;
      legs.push({ hip, rest, foot: rest.clone(), a: L.a, b: L.b, group, side });
    } });
    // soft shadow disc
    const sh = new THREE.Mesh(new THREE.CircleGeometry(15, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.08; root.add(sh);
    scene.add(root);
    const s: Spider = { root, body, abdomen: abd, fangs, palps, legs, phase: Math.random(), heading: 0, last: null, idx: this.spiders.length, walk: 0 };
    this.spiders.push(s); return s;
  }
  /** move a spider to (x, y) in sim coords; it faces its walking direction and its legs step with the distance covered */
  update(s: Spider, x: number, y: number, dt: number, t: number) {
    let speed = 0;
    if (s.last) { const dx = x - s.last.x, dy = y - s.last.y; const d = Math.hypot(dx, dy); speed = d / Math.max(1e-3, dt);
      if (d > 0.02) { const want = Math.atan2(dy, dx); let da = want - s.heading; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2; s.heading += da * Math.min(1, dt * 7); }
      s.phase += d / 15; } else s.last = new THREE.Vector2();
    s.last.set(x, y); s.walk += (Math.min(1, speed / 25) - s.walk) * Math.min(1, dt * 5);
    s.root.position.set(x, 0, y); s.root.rotation.y = -s.heading;
    // body bob with the gait, abdomen breathing, fangs + palps twitch
    const ph = s.phase * Math.PI * 2; s.body.position.y = Math.abs(Math.sin(ph)) * 0.5 * s.walk + Math.sin(t * 2) * 0.12; s.body.rotation.z = Math.sin(ph) * 0.03 * s.walk;
    const br = 1 + Math.sin(t * 2.3) * 0.025; s.abdomen.scale.set(6.2 * br, 4.4 * br, 4.9 * br);
    s.fangs.forEach((f, i) => { f.rotation.x = (i ? -1 : 1) * (0.1 + Math.max(0, Math.sin(t * 7 + i)) * 0.25); });
    s.palps.forEach((p, i) => { p.rotation.z = -1.2 + Math.sin(t * 5 + i * 1.7) * 0.2; });
    // legs: foot target per gait; IK to place femur/tibia instances
    const world = s.root.matrixWorld; s.root.updateMatrixWorld(true); const bodyY = s.body.position.y;
    for (const L of s.legs) {
      const u = (s.phase + L.group * 0.5) % 1; const stride = 6.5 * Math.max(0.15, s.walk);
      let fx: number, fy: number;
      if (u < 0.6) { const k = u / 0.6; fx = stride * (0.5 - k); fy = 0; }               // stance: foot pushes back
      else { const k = (u - 0.6) / 0.4; fx = stride * (-0.5 + k); fy = Math.sin(k * Math.PI) * 3.2 * Math.max(0.3, s.walk); }   // swing: lift and reach
      const foot = v3(L.rest.x + fx, fy, L.rest.z + Math.sin(t * 1.3 + L.rest.x) * 0.3 * (1 - s.walk));
      const hip = L.hip.clone(); hip.y += bodyY;
      const d0 = foot.clone().sub(hip); let d = d0.length(); const n = d0.clone().normalize(); d = Math.min(L.a + L.b - 0.05, Math.max(Math.abs(L.a - L.b) + 0.05, d));
      const cosA = (L.a * L.a + d * d - L.b * L.b) / (2 * L.a * d); const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
      const perp = this.up.clone().sub(n.clone().multiplyScalar(this.up.dot(n))).normalize();
      const knee = hip.clone().add(n.clone().multiplyScalar(L.a * cosA)).add(perp.multiplyScalar(L.a * sinA));
      const tip = hip.clone().add(n.clone().multiplyScalar(d));
      this.seg(this.femur, hip, knee, 1, world); this.seg(this.tibia, knee, tip, 1, world);
    }
  }
  private segCount = { f: 0, t: 0 };
  begin() { this.segCount.f = 0; this.segCount.t = 0; }
  end() { this.femur.count = this.segCount.f; this.tibia.count = this.segCount.t; this.femur.instanceMatrix.needsUpdate = true; this.tibia.instanceMatrix.needsUpdate = true; }
  private seg(im: THREE.InstancedMesh, a: THREE.Vector3, b: THREE.Vector3, _w: number, world: THREE.Matrix4) {
    const A = a.clone().applyMatrix4(world), B = b.clone().applyMatrix4(world); const dir = B.clone().sub(A); const len = dir.length(); dir.normalize();
    this.q.setFromUnitVectors(this.up, dir); this.m4.compose(A, this.q, v3(1, len, 1));
    const key = im === this.femur ? "f" : "t"; const i = this.segCount[key]++; im.setMatrixAt(i, this.m4);
  }
}
