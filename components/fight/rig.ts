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
  fist: number;                                   // 0 open … 1 closed
  wR: Vec3; uR: Vec3; wL: Vec3; uL: Vec3;        // weapon blade direction + edge-up direction per hand (fighter space)
}
export type ResolvedPose = Omit<Pose, "hL" | "hR" | "fL" | "fR"> & { hL: Vec3; hR: Vec3; fL: Vec3; fR: Vec3 };

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const AX = { x: V(1, 0, 0), y: V(0, 1, 0), z: V(0, 0, 1) };
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

function wpos(o: THREE.Object3D, out = V()) { return o.getWorldPosition(out); }
function wquat(o: THREE.Object3D, out = new THREE.Quaternion()) { return o.getWorldQuaternion(out); }
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

export interface Calib { hipY: number; hipZ: number; shY: number; shZ: number; arm: number; leg: number; ankleY: number; headY: number; armK: number; legK: number }

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
  opp: Rig | null = null;
  baseX: number;
  faceYaw: number;
  last: ResolvedPose | null = null;
  visible = true;
  offset = new THREE.Vector3();   // extra world offset (launched into the sky, sinking…)
  offsetSpin = 0;                 // extra tumble

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
    this.cal = { hipY: hips.y, hipZ: hips.z, shY: sh.y, shZ: sh.z, arm, leg, ankleY: ft.y, headY: hd.y, armK: arm / REF.arm, legK: leg / REF.leg };
    const rq = wquat(this.root).invert();
    this.footRest = { L: rq.clone().multiply(wquat(this.b.LeftFoot)), R: rq.clone().multiply(wquat(this.b.RightFoot)) };
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

  resolve(p: Pose): ResolvedPose {
    const opp = this.opp;
    const T = (t: Target, hand: boolean): Vec3 => {
      if (typeof t !== "string") return hand ? this.calHand(t) : this.calFoot(t);
      if (t === "GRIP") return this.calHand([0, 1.4, 0.3]);
      if (!opp) return this.calHand([0, 1.6, 0.9]);
      const part = t.slice(4) as "HEAD" | "CHEST" | "BELLY" | "LEGS";
      return this.toBody(opp.part(part));
    };
    // GRIP: this hand closes on the other hand's weapon handle, just below it
    const grip = (o: Vec3, w: Vec3): Vec3 => [o[0] - w[0] * 0.14, o[1] - w[1] * 0.14, o[2] - w[2] * 0.14];
    let hR: Vec3, hL: Vec3;
    if (p.hL === "GRIP") { hR = T(p.hR, true); hL = grip(hR, p.wR); }
    else if (p.hR === "GRIP") { hL = T(p.hL, true); hR = grip(hL, p.wL); }
    else { hR = T(p.hR, true); hL = T(p.hL, true); }
    return { ...p, hR, hL, fL: T(p.fL, false), fR: T(p.fR, false) };
  }

  /** pose the skeleton */
  apply(P: ResolvedPose, shake = 0) {
    const b = this.b; this.last = P;
    this.root.position.set(this.side * this.baseX - this.side * P.rx, 0, P.rz).add(this.offset);
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
    const BW = (p: Vec3) => this.body.localToWorld(V(p[0], p[1], p[2]));
    const BD = (d: Vec3) => V(d[0], d[1], d[2]).applyQuaternion(bq).normalize();
    ik2(b.LeftArm, b.LeftForeArm, b.LeftHand, BW(P.hL), BD(P.eL));
    ik2(b.RightArm, b.RightForeArm, b.RightHand, BW(P.hR), BD(P.eR));
    this.fists(P.fist);
    ik2(b.LeftUpLeg, b.LeftLeg, b.LeftFoot, BW(P.fL), BD(P.kL));
    ik2(b.RightUpLeg, b.RightLeg, b.RightFoot, BW(P.fR), BD(P.kR));
    setWorldQuat(b.LeftFoot, bq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(P.ftLp, P.ftLy, 0, "YXZ"))).multiply(this.footRest.L));
    setWorldQuat(b.RightFoot, bq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(P.ftRp, P.ftRy, 0, "YXZ"))).multiply(this.footRest.R));
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

  hand(s: "L" | "R") { return wpos(this.b[s === "L" ? "LeftHand" : "RightHand"]); }
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
