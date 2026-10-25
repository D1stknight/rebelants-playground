// components/fight/rig.ts
// A Faction Wars ant driven entirely by code: no animation clips. Every frame the skeleton is reset to its bind pose,
// then posed from a handful of numbers (hip offset/rotation, spine, head) and IK targets for both hands and feet.
// Poses are authored once against the Kenshi model and calibrated to every other faction's proportions at load time.
import * as THREE from "three";

export type Vec3 = [number, number, number];
/** A hand/foot target: a point in the fighter's own space (+Z forward, +Y up, +X its left), or a symbol resolved
 *  every frame: OPP_HEAD / OPP_CHEST / OPP_BELLY / OPP_LEGS (the opponent's body), GRIP (left hand on the right-hand weapon grip). */
export type Target = Vec3 | "OPP_HEAD" | "OPP_CHEST" | "OPP_BELLY" | "OPP_LEGS" | "GRIP";

export interface Pose {
  rx: number; ry: number; rz: number;            // travel toward the opponent / lift / sideways (towards camera)
  tumble: number; roll: number; spin: number;    // whole-body pitch about the hips (knock-down), roll, yaw (turn around)
  hip: Vec3; hipYaw: number; hipPitch: number; hipRoll: number;
  spYaw: number; spPitch: number; spRoll: number;
  hdYaw: number; hdPitch: number; hdRoll: number;
  hL: Target; eL: Vec3; hR: Target; eR: Vec3;    // hand targets + elbow pole directions
  fL: Target; kL: Vec3; fR: Target; kR: Vec3;    // ankle targets + knee pole directions
  ftLy: number; ftLp: number; ftRy: number; ftRp: number; // foot yaw / toe point
  kick?: "instep" | "ball";                       // a striking foot: instep (toes pointed along the shin, top of the foot to the target) or ball (toes pulled back, sole to the target)
  fist: number;                                   // 0 open … 1 closed
  wR: Vec3; uR: Vec3; wL: Vec3; uL: Vec3;        // weapon blade direction + edge-up direction per hand (fighter space)
  look: number;                                   // 0 … 1: the head turns to face the opponent's head
  up?: number;                                    // 0 … 1: strikes arrive from below (uppercut into the chin)
  tipW?: number;                                  // 0 … 1: the right-hand weapon's tip lands on tipAt's surface (the fighter steps in / back)
  tipAt?: "HEAD" | "CHEST" | "BELLY" | "LEGS";
  sh: number;                                     // a katana in hand is sheathed (scabbard shown) when > .5
}
export type ResolvedPose = Omit<Pose, "hL" | "hR" | "fL" | "fR"> & { hL: Vec3; hR: Vec3; fL: Vec3; fR: Vec3; gripL: boolean; gripR: boolean;
  /** strike weights (1 = this limb aims at the opponent) and the body part it aims at */
  sHR: number; sHL: number; sFR: number; sFL: number; pHR?: string; pHL?: string; pFR?: string; pFL?: string };

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const AX = { x: V(1, 0, 0), y: V(0, 1, 0), z: V(0, 0, 1) };
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

function wpos(o: THREE.Object3D, out = V()) { return o.getWorldPosition(out); }
function wquat(o: THREE.Object3D, out = new THREE.Quaternion()) { return o.getWorldQuaternion(out); }
/** world rotation that turns bone-local axes a (main) / b (secondary) onto world directions A / B */
function basisQuat(a: THREE.Vector3, b: THREE.Vector3, A: THREE.Vector3, B: THREE.Vector3) {
  const m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4();
  const x1 = a.clone().normalize(), z1 = x1.clone().cross(b).normalize(), y1 = z1.clone().cross(x1);
  const x2 = A.clone().normalize(), z2 = x2.clone().cross(B).normalize(), y2 = z2.clone().cross(x2);
  m1.makeBasis(x1, y1, z1); m2.makeBasis(x2, y2, z2);
  return new THREE.Quaternion().setFromRotationMatrix(m2.multiply(m1.transpose()));
}
function setWorldQuat(bone: THREE.Object3D, qw: THREE.Quaternion) {
  bone.parent!.updateWorldMatrix(true, false);
  const pinv = wquat(bone.parent!, _qa).invert();
  bone.quaternion.copy(pinv.multiply(qw)); bone.updateMatrixWorld(true);
}
function rotWorld(bone: THREE.Object3D, qDelta: THREE.Quaternion) {
  bone.updateWorldMatrix(true, false);
  const bw = wquat(bone, _qb);
  setWorldQuat(bone, qDelta.clone().multiply(bw));
}
function aim(bone: THREE.Object3D, child: THREE.Object3D, dirWorld: THREE.Vector3) {
  bone.updateWorldMatrix(true, true);
  const a = wpos(bone), b = wpos(child);
  const cur = b.sub(a).normalize();
  if (dirWorld.lengthSq() < 1e-10) return;
  rotWorld(bone, new THREE.Quaternion().setFromUnitVectors(cur, dirWorld.clone().normalize()));
}
/** two-bone IK in world space: A → B → C reaches t, bending toward the pole direction */
function ik2(A: THREE.Object3D, B: THREE.Object3D, C: THREE.Object3D, t: THREE.Vector3, pole: THREE.Vector3) {
  A.updateWorldMatrix(true, true);
  const a = wpos(A), b = wpos(B), c = wpos(C);
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
  const dv = t.clone().sub(a); let d = dv.length(); if (d < 1e-5) return;
  const n = dv.normalize();
  d = THREE.MathUtils.clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const m = pole.clone().sub(n.clone().multiplyScalar(pole.dot(n)));
  if (m.lengthSq() < 1e-8) m.set(0, -1, 0).sub(n.clone().multiplyScalar(-n.y));
  m.normalize();
  const e = a.clone().add(n.clone().multiplyScalar(x)).add(m.multiplyScalar(h));
  aim(A, B, e.clone().sub(a));
  const tt = a.clone().add(n.clone().multiplyScalar(d));
  aim(B, C, tt.sub(wpos(B)));
}

// reference proportions (Kenshi, in body space after grounding) that every pose is authored against
const REF = { hipY: 1.144, shY: 1.585, shZ: -0.08, arm: 0.546, leg: 0.94, ankleY: 0.15, headY: 1.74 };

export interface Calib { hipY: number; hipZ: number; shX: number; shY: number; shZ: number; hipX: number; arm: number; leg: number; ankleY: number; headY: number; armK: number; legK: number; handLen: number; handW: number; wristR: number; handColor?: string }

export class Rig {
  side: -1 | 1;
  root = new THREE.Group();     // on the fight line, faces the opponent
  body = new THREE.Group();     // travel / tumble / spin
  model: THREE.Object3D;
  b: Record<string, THREE.Bone> = {};
  rest = new Map<THREE.Object3D, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  mats: THREE.MeshStandardMaterial[] = [];
  cal!: Calib;
  footRest!: { L: THREE.Quaternion; R: THREE.Quaternion };
  footAxes: Record<"L" | "R", { toe: THREE.Vector3; top: THREE.Vector3 }> = { L: { toe: V(0, 0, 1), top: V(0, 1, 0) }, R: { toe: V(0, 0, 1), top: V(0, 1, 0) } };
  opp: Rig | null = null;
  baseX: number;
  faceYaw: number;
  last: ResolvedPose | null = null;
  visible = true;
  offset = new THREE.Vector3();   // extra world offset (launched into the sky, sinking…)
  offsetSpin = 0;                 // extra tumble
  handLocal: Record<"L" | "R", { F: THREE.Vector3; T: THREE.Vector3 }> = { L: { F: V(1, 0, 0), T: V(0, 1, 0) }, R: { F: V(1, 0, 0), T: V(0, 1, 0) } };
  headFwd = V(0, 0, 1);           // the face's forward in the Head bone's frame
  assistX = 0;                    // weapon-reach assist: metres toward the opponent (set by the fighter so a weapon tip lands on the surface)
  strikeInset = 0.11;             // a punch's target is where the knuckles land, not the wrist
  gripOff: Record<"L" | "R", number> = { L: -0.14, R: -0.14 }; // where the support hand goes along the other hand's weapon

  constructor(model: THREE.Object3D, side: -1 | 1, baseX = 0.78, faceYaw = 0.32) {
    this.side = side; this.baseX = baseX; this.faceYaw = faceYaw;
    this.model = model;
    this.root.add(this.body); this.body.add(model);
    model.traverse((o: any) => {
      if (o.isBone) this.b[o.name.replace(/^mixamorig[_:]?/, "")] = o;
      if (o.isMesh) {
        o.castShadow = true; o.frustumCulled = false;
        const ms = (Array.isArray(o.material) ? o.material : [o.material]).map((m: any) => { const c = m.clone(); c.side = THREE.DoubleSide; c.transparent = false; c.opacity = 1; return c; });
        o.material = Array.isArray(o.material) ? ms : ms[0];
        ms.forEach((m: any) => { if (m.isMeshStandardMaterial) { m.userData.base = { color: m.color.clone(), emissive: m.emissive.clone(), ei: m.emissiveIntensity, map: m.map }; this.mats.push(m); } });
      }
    });
    model.traverse((o) => { if ((o as any).isBone) this.rest.set(o, { q: o.quaternion.clone(), p: o.position.clone() }); });
    this.root.rotation.y = side < 0 ? Math.PI / 2 - faceYaw : -(Math.PI / 2 - faceYaw);
    this.root.position.set(side * baseX, 0, 0);
    this.calibrate();
  }

  /** Measure this model's proportions in body space (feet on the floor, facing +Z). */
  private calibrate() {
    const r = this.root; const saveR = r.rotation.y, saveP = r.position.clone();
    r.rotation.y = 0; r.position.set(0, 0, 0); r.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    this.model.position.y -= box.min.y; this.model.updateMatrixWorld(true);
    const p = (n: string) => this.body.worldToLocal(wpos(this.b[n]));
    const hips = p("Hips"), sh = p("LeftArm"), fa = p("LeftForeArm"), hand = p("LeftHand"), ul = p("LeftUpLeg"), lg = p("LeftLeg"), ft = p("LeftFoot"), hd = p("Head");
    const arm = sh.distanceTo(fa) + fa.distanceTo(hand), leg = ul.distanceTo(lg) + lg.distanceTo(ft);
    this.cal = { hipY: hips.y, hipZ: hips.z, shX: Math.abs(sh.x), shY: sh.y, shZ: sh.z, hipX: Math.abs(ul.x), arm, leg, ankleY: ft.y, headY: hd.y, armK: arm / REF.arm, legK: leg / REF.leg, handLen: 0, handW: 0, wristR: 0 };
    // the hand's own frame (fingers / thumb) in the Hand bone's space, and the face's forward in the Head's
    for (const s of ["L", "R"] as const) {
      const n = s === "L" ? "Left" : "Right"; const hb = this.b[n + "Hand"]; if (!hb) continue;
      const inv = wquat(hb).invert(); const w = wpos(hb);
      const idx = this.b[n + "HandIndex1"], th = this.b[n + "HandThumb1"];
      const F = idx ? wpos(idx).sub(w) : w.clone().sub(wpos(this.b[n + "ForeArm"]));
      const T = th ? wpos(th).sub(w) : null;
      // no thumb bone (Ashigaru): Mixamo hands keep the thumb on the Hand bone's -X (left) / +X (right)
      this.handLocal[s] = { F: F.normalize().applyQuaternion(inv), T: T ? T.normalize().applyQuaternion(inv) : V(s === "L" ? -1 : 1, 0, 0) };
    }
    this.measureHands();
    this.headFwd = V(0, 0, 1).applyQuaternion(wquat(this.b.Head).invert());
    const rq = wquat(this.root).invert();
    this.footRest = { L: rq.clone().multiply(wquat(this.b.LeftFoot)), R: rq.clone().multiply(wquat(this.b.RightFoot)) };
    // the foot's toe and top directions in its own bone space (toe base if the rig has one, else straight ahead)
    for (const s of ["L", "R"] as const) {
      const n = s === "L" ? "Left" : "Right"; const fb = this.b[n + "Foot"], tb = this.b[n + "ToeBase"]; if (!fb) continue;
      const inv = wquat(fb).invert(); const fwd = this.body.localToWorld(V(0, 0, 1)).sub(this.body.localToWorld(V()));
      const toe = tb ? wpos(tb).sub(wpos(fb)) : fwd.clone(); toe.y *= 0.3; toe.normalize();
      const top = V(0, 1, 0).addScaledVector(toe, -toe.y).normalize();
      this.footAxes[s] = { toe: toe.applyQuaternion(inv.clone()), top: top.applyQuaternion(inv) };
    }
    r.rotation.y = saveR; r.position.copy(saveP); r.updateMatrixWorld(true);
  }

  /** authored (Kenshi-space) point → this model's space */
  calHand(p: Vec3): Vec3 { const c = this.cal; return [p[0] * c.armK, c.shY + (p[1] - REF.shY) * c.armK, c.shZ + (p[2] - REF.shZ) * c.armK]; }
  calFoot(p: Vec3): Vec3 {
    const c = this.cal;
    const y = p[1] <= REF.ankleY + 0.02 ? c.ankleY + (p[1] - REF.ankleY) : c.hipY + (p[1] - REF.hipY) * c.legK;
    return [p[0], y, p[2] * c.legK];
  }
  /** world point → this fighter's body space */
  toBody(w: THREE.Vector3): Vec3 { const v = this.body.worldToLocal(w.clone()); return [v.x, v.y, v.z]; }
  part(name: "HEAD" | "CHEST" | "BELLY" | "LEGS"): THREE.Vector3 {
    const b = this.b;
    if (name === "HEAD") return wpos(b.Head).add(V(0, 0.06, 0));
    if (name === "CHEST") return wpos(b.Spine2);
    if (name === "BELLY") return wpos(b.Spine);
    return wpos(b.LeftLeg).add(wpos(b.RightLeg)).multiplyScalar(0.5);
  }
  forward(): THREE.Vector3 { return V(0, 0, 1).applyQuaternion(wquat(this.body)).normalize(); }

  /** body-space unit vector along the fight line toward the opponent */
  towardOpp(): THREE.Vector3 {
    const o = this.opp; const dx = o ? Math.sign(o.root.position.x - this.root.position.x) || -this.side : -this.side;
    const a = this.body.worldToLocal(this.root.position.clone().add(V(dx, 0, 0))).sub(this.body.worldToLocal(this.root.position.clone()));
    a.y = 0; return a.normalize();
  }
  /** +1 if increasing rx moves this fighter toward the opponent */
  rxSign() { const o = this.opp; if (!o) return 1; const dx = Math.sign(o.root.position.x - this.root.position.x) || -this.side; return dx === -this.side ? 1 : -1; }

  resolve(p: Pose): ResolvedPose {
    const opp = this.opp;
    const T = (t: Target, hand: boolean): Vec3 => {
      if (typeof t !== "string") return hand ? this.calHand(t) : this.calFoot(t);
      if (t === "GRIP") return this.calHand([0, 1.4, 0.3]);
      if (!opp) return this.calHand([0, 1.6, 0.9]);
      const part = t.slice(4) as "HEAD" | "CHEST" | "BELLY" | "LEGS";
      return this.toBody(opp.part(part));
    };
    // GRIP: this hand closes on the other hand's weapon handle (the fighter refines it on the real handle)
    const grip = (o: Vec3, w: Vec3, k: number): Vec3 => [o[0] + w[0] * k, o[1] + w[1] * k, o[2] + w[2] * k];
    let hR: Vec3, hL: Vec3;
    if (p.hL === "GRIP") { hR = T(p.hR, true); hL = grip(hR, p.wR, this.gripOff.R); }
    else if (p.hR === "GRIP") { hL = T(p.hL, true); hR = grip(hL, p.wL, this.gripOff.L); }
    else { hR = T(p.hR, true); hL = T(p.hL, true); }
    const part = (t: Target) => (typeof t === "string" && t !== "GRIP" ? t.slice(4) : undefined);
    const out: ResolvedPose = { ...p, hR, hL, fL: T(p.fL, false), fR: T(p.fR, false), gripL: p.hL === "GRIP", gripR: p.hR === "GRIP",
      sHR: part(p.hR) ? 1 : 0, sHL: part(p.hL) ? 1 : 0, sFR: part(p.fR) ? 1 : 0, sFL: part(p.fL) ? 1 : 0, pHR: part(p.hR), pHL: part(p.hL), pFR: part(p.fR), pFL: part(p.fL) };
    return out;
  }

  /** pose the skeleton */
  apply(P: ResolvedPose, shake = 0, dt = 1 / 60) {
    const b = this.b; this.last = P;
    this.root.position.set(this.side * this.baseX - this.side * P.rx, 0, P.rz).add(this.offset);
    if (this.assistX && this.opp) this.root.position.x += (Math.sign(this.opp.root.position.x - this.root.position.x) || -this.side) * this.assistX;
    // body: lift, tumble about the hips, spin
    const piv = V(0, this.cal.hipY - 0.1, 0);
    this.body.rotation.set(P.tumble - this.offsetSpin, P.spin, P.roll, "YXZ");
    this.body.position.copy(piv).sub(piv.clone().applyEuler(this.body.rotation)); this.body.position.y += P.ry;
    if (shake > 0) { this.body.position.x += (Math.random() - 0.5) * shake; this.body.position.z += (Math.random() - 0.5) * shake; }
    for (const [o, r] of this.rest) { o.quaternion.copy(r.q); o.position.copy(r.p); }
    this.root.updateMatrixWorld(true);
    const bq = wquat(this.body);
    const cr = (axis: "x" | "y" | "z", ang: number) => new THREE.Quaternion().setFromAxisAngle(AX[axis].clone().applyQuaternion(bq).normalize(), ang);
    const k = this.cal.legK;
    const hipW = this.body.localToWorld(V(P.hip[0] * k, this.cal.hipY + P.hip[1] * k, this.cal.hipZ + P.hip[2] * k));
    b.Hips.parent!.updateWorldMatrix(true, false); b.Hips.position.copy(b.Hips.parent!.worldToLocal(hipW)); b.Hips.updateMatrixWorld(true);
    rotWorld(b.Hips, cr("y", P.hipYaw).multiply(cr("x", P.hipPitch)).multiply(cr("z", P.hipRoll)));
    for (const s of ["Spine", "Spine1", "Spine2"]) if (b[s]) rotWorld(b[s], cr("y", P.spYaw / 3).multiply(cr("x", P.spPitch / 3)).multiply(cr("z", P.spRoll / 3)));
    if (b.Neck) rotWorld(b.Neck, cr("y", P.hdYaw * 0.4).multiply(cr("x", P.hdPitch * 0.4)));
    rotWorld(b.Head, cr("y", P.hdYaw * 0.6).multiply(cr("x", P.hdPitch * 0.6)).multiply(cr("z", P.hdRoll)));
    // eyes on the opponent: turn the head (and a little of the neck) toward their head
    const o = this.opp; const lk = P.look ?? 0;
    if (lk > 0.01 && o && o.visible && o.model.visible) {
      const hp = wpos(b.Head); const want = o.part("HEAD").sub(hp).normalize();
      const f = this.headFwd.clone().applyQuaternion(wquat(b.Head)).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(f, want); const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
      const k = lk * 0.75 * Math.min(1, 0.9 / Math.max(ang, 1e-3));
      const part = new THREE.Quaternion().slerp(q, k);
      if (b.Neck) rotWorld(b.Neck, new THREE.Quaternion().slerp(part, 0.35));
      rotWorld(b.Head, new THREE.Quaternion().slerp(part, 0.65));
    }
    const BW = (p: Vec3) => this.body.localToWorld(V(p[0], p[1], p[2]));
    const BD = (d: Vec3) => V(d[0], d[1], d[2]).applyQuaternion(bq).normalize();
    // strikes: the fist / instep lands on the opponent's surface, and the fighter steps in if it's out of reach
    const tgt: Partial<Record<"hR" | "hL" | "fR" | "fL", THREE.Vector3>> = {};
    const o2 = this.opp;
    if (o2) {
      const limbs = [["hR", P.sHR, P.pHR, "RightArm", this.cal.arm, this.strikeInset], ["hL", P.sHL, P.pHL, "LeftArm", this.cal.arm, this.strikeInset],
        ["fR", P.sFR, P.pFR, "RightUpLeg", this.cal.leg, 0.08], ["fL", P.sFL, P.pFL, "LeftUpLeg", this.cal.leg, 0.08]] as const;
      let shift = 0;
      for (const [key, w, part, root, len, inset] of limbs) {
        if (!(w > 0.01) || !part) continue;
        const from = wpos(b[root]); const surf = ({ HEAD: 0.11, CHEST: 0.15, BELLY: 0.15, LEGS: 0.1 } as Record<string, number>)[part] ?? 0.12;
        const c = o2.part(part as "HEAD"); const dir = c.clone().sub(from).normalize();
        const upK = key[0] === "h" ? P.up ?? 0 : 0; if (upK > 0.01) dir.lerp(V(0, 1, 0), upK).normalize();
        const t = c.addScaledVector(dir, -(surf * (1 - 0.4 * upK) + inset)); tgt[key] = t;
        const deficit = t.distanceTo(from) - len * 0.985;
        if (deficit > 0) shift = Math.max(shift, Math.min(0.5, deficit / Math.max(0.4, Math.abs(dir.x))) * Math.min(1, w));
      }
      if (shift > 0) {
        const dx = Math.sign(o2.root.position.x - this.root.position.x) || -this.side;
        this.root.position.x += dx * shift; this.root.updateMatrixWorld(true);
      }
      for (const key of ["hR", "hL", "fR", "fL"] as const) {
        const t = tgt[key]; if (!t) continue; const w = Math.min(1, key === "hR" ? P.sHR : key === "hL" ? P.sHL : key === "fR" ? P.sFR : P.sFL);
        tgt[key] = BW(P[key]).lerp(t, w);
      }
    }
    ik2(b.LeftArm, b.LeftForeArm, b.LeftHand, tgt.hL || BW(P.hL), BD(P.eL));
    ik2(b.RightArm, b.RightForeArm, b.RightHand, tgt.hR || BW(P.hR), BD(P.eR));
    if (!this.gloved) this.fists(P.fist);
    // feet: planted feet stay put while the body travels, then step (one at a time, a little lift) — no skating
    const grounded = Math.abs(P.tumble) < 0.15 && P.ry < 0.06 && Math.abs(this.offset.y) < 0.01;
    const footT = { L: tgt.fL || BW(P.fL), R: tgt.fR || BW(P.fR) };
    for (const s of ["L", "R"] as const) {
      const want = footT[s]; const st = this.feet[s]; const struck = s === "L" ? P.sFL > 0.01 : P.sFR > 0.01;
      const low = want.y < this.cal.ankleY + 0.05 + (this.root.position.y);
      if (!grounded || struck || !low || !st.plant) { st.plant = want.clone(); st.step = null; continue; }
      const flat = (a: THREE.Vector3, c: THREE.Vector3) => Math.hypot(a.x - c.x, a.z - c.z);
      if (st.step) {
        st.step.to.copy(want); st.step.t += dt; const u = Math.min(1, st.step.t / st.step.dur); const e = u * u * (3 - 2 * u);
        const p = st.step.from.clone().lerp(want, e); p.y = want.y + Math.sin(u * Math.PI) * 0.075; footT[s] = p;
        if (u >= 1) { st.plant = want.clone(); st.step = null; }
      } else {
        const d = flat(want, st.plant); const other = this.feet[s === "L" ? "R" : "L"];
        if (d > 0.9) { st.plant = want.clone(); }
        else if (d > 0.12 && !other.step) { st.step = { from: st.plant.clone(), to: want.clone(), t: 0, dur: 0.1 + d * 0.12 }; footT[s] = st.plant.clone().setY(want.y); }
        else footT[s] = st.plant.clone().setY(want.y);
      }
    }
    ik2(b.LeftUpLeg, b.LeftLeg, b.LeftFoot, footT.L, BD(P.kL));
    ik2(b.RightUpLeg, b.RightLeg, b.RightFoot, footT.R, BD(P.kR));
    setWorldQuat(b.LeftFoot, bq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(P.ftLp, P.ftLy, 0, "YXZ"))).multiply(this.footRest.L));
    setWorldQuat(b.RightFoot, bq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(P.ftRp, P.ftRy, 0, "YXZ"))).multiply(this.footRest.R));
    // feet off the floor point along the shin (no flat "standing" foot on a kicking or chambered leg); a striking foot is shaped by
    // its kick: instep (toes along the shin, top of the foot to the target) or ball (toes pulled back, sole to the target)
    for (const s of ["L", "R"] as const) {
      const n = s === "L" ? "Left" : "Right"; const fb = b[n + "Foot"]; const ank = wpos(fb), knee = wpos(b[n + "Leg"]);
      const ws = P.kick ? Math.min(1, s === "L" ? P.sFL : P.sFR) : 0; const part = s === "L" ? P.pFL : P.pFR;
      const raise = Math.min(1, Math.max(0, (ank.y - this.cal.ankleY - 0.12) / 0.25)) * (Math.abs(P.tumble) < 0.5 ? 0.85 : 0.6);
      const w = Math.max(ws > 0.01 && part ? ws : 0, raise); if (!(w > 0.01)) continue;
      const shin = ank.clone().sub(knee).normalize();
      const to = o2 ? o2.part(((ws > 0.01 && part) || "CHEST") as "HEAD").sub(ank).normalize() : V(0, 0, 1).applyQuaternion(bq);
      let D: THREE.Vector3, U: THREE.Vector3;
      if (P.kick === "ball" && ws > 0.01) { U = to.clone().negate(); D = V(0, 1, 0).addScaledVector(U, -U.y).normalize(); }
      else { D = shin; U = to.clone().addScaledVector(D, -to.dot(D)); if (U.lengthSq() < 1e-4) U = V(0, 1, 0).addScaledVector(D, -D.y); U.normalize(); }
      const ax = this.footAxes[s]; const qWant = basisQuat(ax.toe, ax.top, D, U);
      setWorldQuat(fb, wquat(fb).slerp(qWant, w));
    }
  }

  private fists(amount: number) {
    if (amount <= 0.01) return;
    const b = this.b;
    for (const s of ["Left", "Right"]) {
      const i1 = b[s + "HandIndex1"], t1 = b[s + "HandThumb1"]; if (!i1) continue;
      for (const [bn, ang] of [["HandIndex1", 0.9], ["HandIndex2", 1.1], ["HandIndex3", 0.9], ["HandThumb2", 0.5], ["HandThumb3", 0.5]] as const) {
        const bo = b[s + bn]; if (!bo) continue; const ch = bo.children.find((c: any) => c.isBone); if (!ch) continue;
        bo.updateWorldMatrix(true, true);
        const d = wpos(ch).sub(wpos(bo)).normalize();
        const across = t1 ? wpos(i1).sub(wpos(t1)) : V(0, 1, 0);
        across.sub(d.clone().multiplyScalar(across.dot(d))); if (across.lengthSq() < 1e-8) continue; across.normalize();
        rotWorld(bo, new THREE.Quaternion().setFromAxisAngle(across, ang * 1.3 * amount * (s === "Left" ? 1 : -1)));
      }
    }
  }

  private texCache = new Map<any, { d: Uint8ClampedArray; w: number; h: number } | null>();
  /** the sculpted texture's colour under one vertex (sRGB 0..255), read from a small copy of the material's map */
  private texel(o: any, i: number): number[] | null {
    const m = Array.isArray(o.material) ? o.material[0] : o.material; const map = m?.map, uv = o.geometry.attributes.uv; if (!map || !uv || typeof document === "undefined") return null;
    let t = this.texCache.get(map);
    if (t === undefined) {
      t = null;
      try { const img = map.image; if (img && (img.width || img.naturalWidth)) { const c = document.createElement("canvas"); c.width = 128; c.height = 128; const x = c.getContext("2d", { willReadFrequently: true })!; x.drawImage(img, 0, 0, 128, 128); t = { d: x.getImageData(0, 0, 128, 128).data, w: 128, h: 128 }; } } catch { t = null; }
      this.texCache.set(map, t);
    }
    if (!t) return null;
    let u = uv.getX(i), v = uv.getY(i); u -= Math.floor(u); v -= Math.floor(v); if (map.flipY) v = 1 - v;
    const px = Math.min(t.w - 1, Math.floor(u * t.w)), py = Math.min(t.h - 1, Math.floor(v * t.h)); const k = (py * t.w + px) * 4;
    return [t.d[k], t.d[k + 1], t.d[k + 2]];
  }
  /** the sculpted hands' size (wrist → fingertips, across the knuckles) and the wrist's radius, from the skinned vertices */
  private measureHands() {
    const ext = { len: [] as number[], w: [] as number[], r: [] as number[] };
    const v = new THREE.Vector3();
    for (const s of ["L", "R"] as const) {
      const n = s === "L" ? "Left" : "Right"; const hb = this.b[n + "Hand"], fb = this.b[n + "ForeArm"]; if (!hb || !fb) continue;
      const w = wpos(hb), q = wquat(hb), F = this.handLocal[s].F.clone().applyQuaternion(q).normalize();
      const T = this.handLocal[s].T.clone().applyQuaternion(q); T.addScaledVector(F, -T.dot(F)).normalize();
      let len = 0, tmin = 0, tmax = 0; const rr: number[] = [];
      const cols: number[][] = [];
      this.model.traverse((o: any) => {
        if (!o.isSkinnedMesh) return; const sk = o.skeleton, si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight, pos = o.geometry.attributes.position; if (!si || !pos) return;
        const handIdx = new Set<number>(), faIdx = sk.bones.indexOf(fb);
        sk.bones.forEach((bn: THREE.Bone, i: number) => { if (bn === hb || bn.name.replace(/^mixamorig[_:]?/, "").startsWith(n + "Hand")) handIdx.add(i); });
        for (let i = 0; i < pos.count; i++) {
          const ws = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)], is = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)]; let best = -1, bw = 0; for (let k = 0; k < 4; k++) if (ws[k] > bw) { bw = ws[k]; best = is[k]; }
          if (!handIdx.has(best) && best !== faIdx) continue;
          o.getVertexPosition(i, v); o.localToWorld(v); const d = v.clone().sub(w); const a = d.dot(F);
          if (handIdx.has(best) && a > 0.04 && i % 3 === 0) { const px = this.texel(o, i); if (px) cols.push(px); }
          if (handIdx.has(best)) { if (a > len) len = a; const t = d.dot(T); if (a > 0.02) { tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); } }
          else if (a > -0.06 && a < -0.01) rr.push(d.addScaledVector(F, -a).length());
        }
      });
      if (len > 0.05) { ext.len.push(len); ext.w.push(tmax - tmin); }
      if (cols.length > 20) { for (const c of [0, 1, 2]) { const v2 = cols.map((x) => x[c]).sort((x, y) => x - y); (ext as any)["c" + c] = ((ext as any)["c" + c] || []).concat([v2[v2.length >> 1]]); } }
      if (rr.length) { rr.sort((x, y) => x - y); ext.r.push(rr[Math.floor(rr.length * 0.8)]); }
    }
    const avg = (a: number[], d: number) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : d);
    const e2 = ext as any; if (e2.c0) this.cal.handColor = "#" + [e2.c0, e2.c1, e2.c2].map((a: number[]) => Math.round(avg(a, 0)).toString(16).padStart(2, "0")).join("");
    this.cal.handLen = avg(ext.len, 0.19 * this.cal.armK); this.cal.handW = avg(ext.w, 0.09 * this.cal.armK); this.cal.wristR = avg(ext.r, 0.045 * this.cal.armK);
  }
  hand(s: "L" | "R") { return wpos(this.b[s === "L" ? "LeftHand" : "RightHand"]); }
  gloved = false;
  feet: Record<"L" | "R", { plant: THREE.Vector3 | null; step: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null }> = { L: { plant: null, step: null }, R: { plant: null, step: null } };
  /** shrink the sculpted hands to the wrist (the gloves replace them) */
  hideHands() { this.gloved = true; for (const n of ["LeftHand", "RightHand"]) this.b[n]?.scale.setScalar(0.001); }
  /** the hand's frame in the world: wrist, finger direction, thumb direction, forearm direction */
  handFrame(s: "L" | "R") {
    const n = s === "L" ? "Left" : "Right"; const hb = this.b[n + "Hand"]; const q = wquat(hb); const w = wpos(hb);
    return { wrist: w, F: this.handLocal[s].F.clone().applyQuaternion(q), T: this.handLocal[s].T.clone().applyQuaternion(q), fa: w.clone().sub(wpos(this.b[n + "ForeArm"])).normalize() };
  }
  /** re-solve one arm so its wrist reaches a world point (pole in fighter space) */
  reach(s: "L" | "R", target: THREE.Vector3, pole: Vec3) {
    const n = s === "L" ? "Left" : "Right"; const b = this.b;
    for (const k of [n + "Arm", n + "ForeArm"]) { const r = this.rest.get(b[k]); if (r) b[k].quaternion.copy(r.q); }
    b[n + "Shoulder"]?.updateMatrixWorld(true);
    ik2(b[n + "Arm"], b[n + "ForeArm"], b[n + "Hand"], target, V(pole[0], pole[1], pole[2]).applyQuaternion(wquat(this.body)).normalize());
  }
  foot(s: "L" | "R") { return wpos(this.b[s === "L" ? "LeftFoot" : "RightFoot"]); }
  /** fighter-space direction → world */
  dirW(d: Vec3) { return V(d[0], d[1], d[2]).applyQuaternion(wquat(this.body)).normalize(); }

  // ── material looks ─────────────────────────────────────────────────────────
  tint(mode: "none" | "hit" | "stone" | "gold" | "char" | "glow", color?: string, k = 1) {
    for (const m of this.mats) {
      const base = m.userData.base; if (!base) continue;
      m.color.copy(base.color); m.emissive.copy(base.emissive); m.emissiveIntensity = base.ei;
      if (mode === "hit") { m.emissive.set("#ff2a2a"); m.emissiveIntensity = 0.9 * k; }
      if (mode === "stone") { const g = (base.color.r + base.color.g + base.color.b) / 3; m.color.lerp(new THREE.Color(g * 0.55 + 0.25, g * 0.55 + 0.24, g * 0.5 + 0.22), k); m.emissiveIntensity = base.ei * (1 - k); }
      if (mode === "gold") { m.color.lerp(new THREE.Color("#ffcc55"), k); m.emissive.set("#7a4a00"); m.emissiveIntensity = 0.5 * k; }
      if (mode === "char") { m.color.lerp(new THREE.Color("#1a1210"), k); m.emissive.set("#ff4a10"); m.emissiveIntensity = 0.35 * k; }
      if (mode === "glow") { m.emissive.set(color || "#ffffff"); m.emissiveIntensity = 2 * k; }
    }
  }
  setOpacity(o: number) {
    for (const m of this.mats) { m.transparent = o < 1; m.opacity = o; m.depthWrite = o > 0.5; }
    this.model.visible = o > 0.001 && this.visible;
  }
}
