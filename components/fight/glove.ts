// components/fight/glove.ts — the Universe (Forge Rigger) cartoon glove, built at runtime from primitives:
// palm, cuff and five jointed fingers that close into a fist or round a weapon's handle.
// Canonical RIGHT hand, hand length 1: wrist at the origin, +X toward the fingertips, +Z the back of the hand,
// +Y the thumb side. The left glove is the mirror (y → -y). Same proportions and finger poses as
// rebel-ants-village forge-worker/rigger/glove.py + handswap.py POSE.
import * as THREE from "three";

type F5 = "Index" | "Middle" | "Ring" | "Pinky" | "Thumb";
const FINGERS: Record<F5, { k: [number, number, number]; d: [number, number, number]; ls: [number, number, number]; r: number }> = {
  Index: { k: [0.47, 0.158, 0.03], d: [1.0, 0.16, -0.03], ls: [0.17, 0.11, 0.09], r: 0.056 },
  Middle: { k: [0.49, 0.053, 0.034], d: [1.0, 0.04, -0.03], ls: [0.185, 0.12, 0.1], r: 0.058 },
  Ring: { k: [0.47, -0.052, 0.03], d: [1.0, -0.09, -0.03], ls: [0.17, 0.11, 0.09], r: 0.055 },
  Pinky: { k: [0.43, -0.152, 0.022], d: [1.0, -0.24, -0.03], ls: [0.13, 0.09, 0.08], r: 0.049 },
  Thumb: { k: [0.15, 0.15, -0.03], d: [0.85, 0.48, -0.4], ls: [0.125, 0.1, 0.085], r: 0.064 },
};
// degrees closed per segment (the rigger's POSE table, sign flipped: + closes toward the palm)
type PoseName = "open" | "relaxed" | "fist" | "grip";
const POSE: Record<PoseName, Record<F5, [number, number, number]>> = {
  open: { Index: [4, 6, 4], Middle: [4, 6, 4], Ring: [4, 6, 4], Pinky: [4, 6, 4], Thumb: [0, 4, 4] },
  relaxed: { Index: [14, 22, 14], Middle: [18, 26, 16], Ring: [22, 30, 18], Pinky: [26, 34, 20], Thumb: [10, 10, 10] },
  fist: { Index: [88, 95, 50], Middle: [90, 95, 50], Ring: [90, 95, 50], Pinky: [90, 95, 50], Thumb: [0, 38, 30] },
  grip: { Index: [62, 78, 40], Middle: [68, 80, 42], Ring: [72, 82, 42], Pinky: [76, 84, 42], Thumb: [0, 30, 25] },
};
const D2R = Math.PI / 180;
// the thumb's knuckle direction per pose (right hand): a fist lays it across the index finger's middle segment,
// a grip wraps it round the handle opposite the fingers (Universe glove: same idea as handswap's thumb opposition)
const THUMB_DIR: Record<PoseName, [number, number, number]> = {
  open: [0.85, 0.48, -0.4], relaxed: [0.85, 0.36, -0.42], fist: [0.88, 0.04, -0.48], grip: [0.75, -0.02, -0.66],
};
// which way the thumb's outer segments curl (toward the palm when open, across the fingers in a fist)
const THUMB_BEND: Record<PoseName, [number, number, number]> = { open: [0, -0.3, -1], relaxed: [0, -0.4, -1], fist: [0, -1, -0.35], grip: [0, -1, -0.25] };

/** glove + cuff colours per faction (the armour palettes) */
export const GLOVE_COLORS: Record<string, [string, string]> = {
  ronin: ["#1b1b20", "#8b1a1a"], samurai: ["#2a2023", "#b3222a"], shogun: ["#2a1d3a", "#c9a23a"], bushi: ["#1c2840", "#c9a23a"],
  buke: ["#3b4220", "#c8b27a"], ashigaru: ["#2f4a24", "#b08a4a"], kenshi: ["#23484c", "#9aa7ae"], yamabushi: ["#1f3d3f", "#7fd6ff"],
  sohei: ["#5a3b1e", "#e08a1e"], wokou: ["#3a2618", "#7a2a22"], warrior: ["#4a2618", "#a0522d"],
};

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

export class Glove {
  root = new THREE.Group();        // world placement (scale = hand length)
  side: "L" | "R";
  L: number;
  joints: Record<F5, THREE.Object3D[]> = {} as any;
  private base: Record<F5, THREE.Quaternion> = {} as any;
  axes: Record<F5, THREE.Vector3> = {} as any;   // flex axis per finger (joint-local)
  /** where a handle sits inside the closed hand, and the striking knuckles (glove-local, hand length 1) */
  gripCenter = new THREE.Vector3();
  knuckles = new THREE.Vector3();
  private mats: THREE.Material[] = [];

  constructor(side: "L" | "R", L: number, gloveColor: string, cuffColor: string, cuffK = 1) {
    this.side = side; this.L = L;
    const my = side === "L" ? -1 : 1;
    const gm = new THREE.MeshStandardMaterial({ color: gloveColor, roughness: 0.62, metalness: 0.05 });
    const cm = new THREE.MeshStandardMaterial({ color: cuffColor, roughness: 0.55, metalness: 0.25 });
    this.mats.push(gm, cm);
    const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D) => { const o = new THREE.Mesh(g, m); o.castShadow = true; parent.add(o); return o; };
    // palm: two soft ellipsoids
    for (const [c, s] of [[[0.25, 0, 0], [0.27, 0.215, 0.115]], [[0.42, 0, 0.018], [0.1, 0.215, 0.095]]] as [number[], number[]][]) {
      const g = new THREE.SphereGeometry(1, 20, 14); g.scale(s[0], s[1], s[2]); g.translate(c[0], c[1] * my, c[2]); add(g, gm, this.root);
    }
    // cuff: an oval tube reaching back into the sleeve
    { const g = new THREE.CapsuleGeometry(0.13, 0.17, 6, 18); g.rotateZ(Math.PI / 2); g.scale(1, (0.17 / 0.13) * cuffK, cuffK); g.translate(-0.135, 0, 0); add(g, cm, this.root);
      const band = new THREE.TorusGeometry(0.138, 0.02, 8, 24); band.rotateY(Math.PI / 2); band.scale(1, (0.172 / 0.138) * cuffK, cuffK); band.translate(-0.01, 0, 0); add(band, cm, this.root); }
    // fingers: three capsule segments on a joint chain
    for (const f of Object.keys(FINGERS) as F5[]) {
      const d = FINGERS[f]; const dir = new THREE.Vector3(d.d[0], d.d[1] * my, d.d[2]).normalize();
      let parent: THREE.Object3D = this.root; const chain: THREE.Object3D[] = [];
      for (let i = 0; i < 3; i++) {
        const j = new THREE.Object3D();
        if (i === 0) { j.position.set(d.k[0], d.k[1] * my, d.k[2]); j.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir); }
        else j.position.set(d.ls[i - 1], 0, 0);
        parent.add(j); chain.push(j);
        const r = d.r * (1 - 0.08 * i); const len = d.ls[i];
        const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 10); g.rotateZ(-Math.PI / 2); g.translate(len / 2, 0, 0);
        add(g, gm, j);
        parent = j;
      }
      // fingertip marker (no mesh) for measuring
      const tip = new THREE.Object3D(); tip.position.set(d.ls[2], 0, 0); chain[2].add(tip); chain.push(tip);
      this.joints[f] = chain; this.base[f] = chain[0].quaternion.clone();
      if (f === "Thumb") {
        // the thumb closes across the palm: axis ⟂ to it and to the back of the hand, in the knuckle joint's frame
        const ax = new THREE.Vector3(0, 0, 1).cross(dir).normalize();
        const inv = chain[0].quaternion.clone().invert(); this.axes[f] = ax.applyQuaternion(inv);
      } else this.axes[f] = new THREE.Vector3(0, 1, 0);
    }
    this.root.scale.setScalar(L);
    // measure the grip hole and the knuckles in the canonical frame
    this.setPose("grip");
    const mid = this.joints.Middle, idx = this.joints.Index;
    const loc = (o: THREE.Object3D) => { this.root.updateMatrixWorld(true); const p = o.getWorldPosition(new THREE.Vector3()); return this.root.worldToLocal(p); };
    const pts = [loc(mid[0]), loc(mid[1]), loc(mid[2]), loc(mid[3]), loc(idx[1]), loc(idx[2])];
    this.gripCenter.copy(pts.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / pts.length));
    this.gripCenter.y = 0;
    this.setPose("fist");
    this.knuckles.copy(loc(mid[1])).lerp(loc(idx[1]), 0.5); this.knuckles.x += 0.04;
    this.setPose("relaxed");
  }
  private apply(a: Record<F5, [number, number, number]>, thumb?: [number, number, number], bend?: [number, number, number]) {
    for (const f of Object.keys(FINGERS) as F5[]) {
      const ch = this.joints[f]; const ax = this.axes[f];
      if (f === "Thumb" && thumb) {
        // aim the thumb's knuckle, then curl its two outer segments about the axis across its nail
        const my = this.side === "L" ? -1 : 1; const d = new THREE.Vector3(thumb[0], thumb[1] * my, thumb[2]).normalize();
        ch[0].quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d);
        const bd = new THREE.Vector3(bend![0], bend![1] * my, bend![2]); const axW = d.clone().cross(bd).normalize(); const axL = axW.applyQuaternion(ch[0].quaternion.clone().invert());
        for (let i = 1; i < 3; i++) ch[i].quaternion.setFromAxisAngle(axL, a[f][i] * D2R);
        continue;
      }
      ch[0].quaternion.copy(this.base[f]).multiply(new THREE.Quaternion().setFromAxisAngle(ax, a[f][0] * D2R));
      for (let i = 1; i < 3; i++) ch[i].quaternion.setFromAxisAngle(ax, a[f][i] * D2R);
    }
  }
  setPose(p: PoseName) { this.apply(POSE[p], THUMB_DIR[p], THUMB_BEND[p]); }
  /** 0 open … 0.5 relaxed … 1 fist; grip overrides */
  setCurl(fist: number, grip: boolean) {
    if (grip) { this.setPose("grip"); return; }
    const f = Math.max(0, Math.min(1, fist)); const [pa, pb, u] = (f < 0.5 ? ["open", "relaxed", f * 2] : ["relaxed", "fist", (f - 0.5) * 2]) as [PoseName, PoseName, number];
    const A = POSE[pa], B = POSE[pb], ta = THUMB_DIR[pa], tb = THUMB_DIR[pb], ba = THUMB_BEND[pa], bb = THUMB_BEND[pb];
    const out = {} as Record<F5, [number, number, number]>;
    for (const k of Object.keys(A) as F5[]) out[k] = [0, 1, 2].map((i) => A[k][i] + (B[k][i] - A[k][i]) * u) as [number, number, number];
    const L3 = (x: number[], y: number[]) => [0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * u) as [number, number, number];
    this.apply(out, L3(ta, tb), L3(ba, bb));
  }
  /** put the wrist at `wrist`, fingers along X, thumb toward `thumb` (world vectors) */
  place(wrist: THREE.Vector3, X: THREE.Vector3, thumb: THREE.Vector3) {
    _x.copy(X).normalize();
    _y.copy(thumb).sub(_x.clone().multiplyScalar(thumb.dot(_x)));
    if (_y.lengthSq() < 1e-8) _y.set(0, 1, 0).sub(_x.clone().multiplyScalar(_x.y));
    _y.normalize(); if (this.side === "L") _y.negate();     // the mirrored glove's thumb is on -Y
    _z.crossVectors(_x, _y).normalize();
    _m.makeBasis(_x, _y, _z); this.root.quaternion.setFromRotationMatrix(_m); this.root.position.copy(wrist);
    this.root.updateMatrixWorld(true);
  }
  /** world point of a glove-local (hand length 1) point */
  world(p: THREE.Vector3, out = new THREE.Vector3()) { return out.copy(p).applyMatrix4(this.root.matrixWorld); }
  dispose() { this.root.traverse((o: any) => o.geometry?.dispose?.()); this.mats.forEach((m) => m.dispose()); }
}
