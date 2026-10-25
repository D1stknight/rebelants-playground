// components/fight/moves.ts — the pose library and every combat action, authored as keyed poses (fighter space).
import type { Pose, Target, Vec3 } from "./rig";

export type Ease = "lin" | "io" | "out" | "snap" | "in" | "back";
export const EASE: Record<Ease, (u: number) => number> = {
  lin: (u) => u, io: (u) => u * u * (3 - 2 * u), out: (u) => 1 - Math.pow(1 - u, 3), snap: (u) => 1 - Math.pow(1 - u, 5), in: (u) => u * u * u,
  back: (u) => { const c = 1.7; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); },
};

export type WeaponId = "katana" | "wakizashi" | "yari" | "naginata" | "bo" | "kanabo" | "ono" | "yumi" | "arrow" | "shuriken" | "kunai" | "tessen" | "scroll" | "cutlass" | "bomb" | "gourd" | "shakujo" | "conch" | "teppo" | "orb";
export type Limb = "hL" | "hR" | "fL" | "fR" | "wR" | "wL";
export type Ev =
  | { k: "hit"; limb: Limb; power: 1 | 2 | 3; at?: "HEAD" | "CHEST" | "BELLY" }
  | { k: "proj"; what: "orb" | "shuriken" | "kunai" | "arrow"; from: Limb; dur: number; power: 1 | 2 | 3; n?: number; gap?: number; arc?: number }
  | { k: "weapon"; R?: WeaponId | null; L?: WeaponId | null }
  | { k: "vis"; on: boolean }
  | { k: "smoke" }
  | { k: "charge"; limb: Limb }
  | { k: "whoosh" };

export interface Key { t: number; p: string | Partial<Pose>; e?: Ease }
export interface ActionDef {
  name: string; keys: Key[]; loop?: boolean; next?: string; ev?: [number, Ev][];
  offensive?: boolean; guard?: [number, number];   // blocking between these times
  weapons?: { R?: WeaponId | null; L?: WeaponId | null };
}

// ── poses ─────────────────────────────────────────────────────────────────────
const UP: Vec3 = [0, 1, 0.2];
export const STANCE: Pose = {
  rx: 0, ry: 0, rz: 0, tumble: 0, roll: 0, spin: 0,
  hip: [0, -0.09, 0], hipYaw: -0.45, hipPitch: 0.06, hipRoll: 0, spYaw: -0.05, spPitch: 0.08, spRoll: 0, hdYaw: 0.45, hdPitch: -0.05, hdRoll: 0,
  hL: [0.13, 1.52, 0.34], eL: [0.6, -1, -0.2], hR: [-0.03, 1.5, 0.2], eR: [-0.6, -1, -0.3],
  fL: [0.17, 0.15, 0.3], kL: [0.2, 0, 1], ftLy: -0.15, ftLp: 0, fR: [-0.16, 0.15, -0.3], kR: [-0.2, 0, 1], ftRy: -0.6, ftRp: 0,
  fist: 1, wR: UP, uR: [0, 0, 1], wL: UP, uL: [0, 0, 1], look: 1, sh: 0, up: 0, tipW: 0,
};
export const P = (o: Partial<Pose>): Pose => ({ ...STANCE, ...o });

export const POSES: Record<string, Pose> = {
  stance: STANCE,
  bob: P({ hip: [0, -0.12, 0], hL: [0.13, 1.49, 0.34], hR: [-0.03, 1.47, 0.2] }),
  tall: P({ look: 0, hip: [0, -0.02, 0], hipYaw: -0.2, spYaw: 0, hdYaw: 0.2, hdPitch: -0.05, hL: [0.25, 1.15, 0.12], eL: [1, -1, -0.3], hR: [-0.25, 1.15, 0.1], eR: [-1, -1, -0.3], fL: [0.15, 0.15, 0.1], fR: [-0.15, 0.15, -0.1], ftRy: -0.2, fist: 0.6 }),
  // punches
  jabWind: P({ rx: 0.18, hipYaw: -0.5, hL: [0.15, 1.5, 0.28], spYaw: -0.08 }),
  jab: P({ rx: 0.42, hipYaw: -0.62, spYaw: -0.25, spPitch: 0.14, hdYaw: 0.75, hL: "OPP_HEAD", eL: [0.9, -0.4, 0], fL: [0.17, 0.15, 0.42] }),
  jabBack: P({ rx: 0.36, hipYaw: -0.5 }),
  crossWind: P({ rx: 0.38, hipYaw: -0.55, spYaw: -0.15, hR: [-0.06, 1.5, 0.12] }),
  cross: P({ rx: 0.5, hipYaw: 0.1, spYaw: 0.35, spPitch: 0.18, hdYaw: -0.25, hR: "OPP_HEAD", eR: [-0.9, -0.4, 0], hL: [0.14, 1.56, 0.12], fL: [0.17, 0.15, 0.45], fR: [-0.13, 0.15, -0.18], ftRy: 0.2, ftRp: 0.35 }),
  crouch: P({ rx: 0.55, hip: [0, -0.28, -0.02], hipYaw: -0.1, hipPitch: 0.15, spPitch: 0.25, spYaw: -0.1, hdYaw: 0.1, hR: [-0.08, 1.12, 0.28], eR: [-0.5, -1, -0.4], hL: [0.12, 1.4, 0.3], fL: [0.2, 0.15, 0.35], fR: [-0.18, 0.15, -0.3] }),
  uppercut: P({ up: 0.85, rx: 0.7, ry: 0.1, hip: [0, 0.04, 0.06], hipYaw: 0.4, hipPitch: -0.12, spPitch: -0.3, spYaw: 0.35, hdYaw: -0.2, hdPitch: -0.2, hR: "OPP_HEAD", eR: [-0.25, -1, 0.15], hL: [0.12, 1.45, 0.15], fL: [0.17, 0.15, 0.42], fR: [-0.12, 0.2, -0.15], ftRp: 0.5 }),
  upFollow: P({ rx: 0.65, ry: 0.08, hip: [0, 0.03, 0.05], hipYaw: 0.45, hipPitch: -0.15, spPitch: -0.35, spYaw: 0.4, hdYaw: -0.2, hdPitch: -0.25, hR: [-0.02, 2.05, 0.42], eR: [-0.3, -1, 0.1], hL: [0.12, 1.45, 0.15], fL: [0.17, 0.15, 0.42], fR: [-0.12, 0.2, -0.15], ftRp: 0.5 }),
  // kicks
  chamber: P({ rx: 0.3, hipYaw: 0.15, hipPitch: -0.05, spPitch: -0.12, spYaw: 0.1, hdYaw: 0.1, hip: [0.04, -0.05, 0.05], fR: [-0.32, 0.95, 0.12], kR: [-0.5, 0.6, 1], ftRp: 0.9, ftRy: 0.4, hL: [0.3, 1.32, 0.3], hR: [-0.05, 1.6, 0.18], fL: [0.12, 0.15, 0.15], ftLy: 0.6 }),
  kickHigh: P({ rx: 0.42, hipYaw: 1.1, hipPitch: -0.2, hipRoll: -0.35, spPitch: -0.5, spYaw: 0.15, spRoll: 0.28, hdYaw: -0.9, hdPitch: 0.25, hip: [0.05, 0.0, 0.0], fR: "OPP_HEAD", kR: [-0.9, 0.5, 0.2], ftRp: 1.2, ftRy: 0, hL: [0.45, 1.25, -0.05], eL: [1, -0.5, -0.4], hR: [-0.08, 1.62, 0.2], fL: [0.08, 0.15, 0.05], ftLy: 1.2 }),
  kickMid: P({ rx: 0.42, hipYaw: 1.05, hipPitch: -0.15, hipRoll: -0.25, spPitch: -0.38, spYaw: 0.15, spRoll: 0.2, hdYaw: -0.9, hdPitch: 0.15, hip: [0.05, -0.02, 0.0], fR: "OPP_CHEST", kR: [-0.9, 0.5, 0.2], ftRp: 1.2, ftRy: 0, hL: [0.45, 1.25, -0.05], eL: [1, -0.5, -0.4], hR: [-0.08, 1.62, 0.2], fL: [0.08, 0.15, 0.05], ftLy: 1.2 }),
  kickBack: P({ rx: 0.3, hipYaw: 0.6, spPitch: -0.2, hdYaw: -0.3, fR: [-0.3, 0.8, 0.2], kR: [-0.6, 0.4, 1], ftRp: 0.8, hL: [0.3, 1.35, 0.2], hR: [-0.06, 1.58, 0.2], fL: [0.12, 0.15, 0.1], ftLy: 0.8 }),
  frontKick: P({ rx: 0.45, hipYaw: -0.1, hipPitch: -0.25, spPitch: -0.3, hdYaw: 0.1, fL: "OPP_BELLY", kL: [0.2, 0.6, 1], ftLp: 0.9, hL: [0.2, 1.55, 0.15], hR: [-0.1, 1.5, 0.12], fR: [-0.14, 0.15, -0.2] }),
  // guard / reactions
  block: P({ hip: [0, -0.13, -0.02], hipYaw: -0.3, spPitch: 0.22, hdPitch: 0.3, hL: [0.12, 1.78, 0.3], eL: [0.3, -0.3, 1], hR: [-0.1, 1.74, 0.28], eR: [-0.3, -0.3, 1] }),
  blockPush: P({ rx: -0.18, hip: [0, -0.15, -0.03], hipYaw: -0.3, spPitch: 0.15, hdPitch: 0.3, hL: [0.12, 1.76, 0.3], eL: [0.3, -0.3, 1], hR: [-0.1, 1.72, 0.27], eR: [-0.3, -0.3, 1] }),
  hitHead: P({ look: 0, rx: -0.12, hip: [0, -0.1, -0.06], hipPitch: -0.12, spPitch: -0.32, spYaw: -0.3, hdPitch: -0.6, hdYaw: 0.1, hdRoll: 0.3, hL: [0.38, 1.3, -0.02], eL: [0.6, -1, -0.3], hR: [-0.32, 1.28, -0.08], eR: [-0.6, -1, -0.3], fist: 0.4 }),
  hitHeavy: P({ look: 0, rx: -0.32, hip: [0, -0.12, -0.08], hipPitch: -0.18, spPitch: -0.4, spYaw: 0.35, hdPitch: -0.7, hdYaw: -0.3, hdRoll: -0.35, hL: [0.42, 1.25, -0.08], eL: [0.6, -1, -0.3], hR: [-0.36, 1.22, -0.12], eR: [-0.6, -1, -0.3], fL: [0.17, 0.15, 0.2], fist: 0.3 }),
  hitBody: P({ look: 0, rx: -0.2, hip: [0, -0.2, -0.1], hipPitch: 0.25, spPitch: 0.45, hdPitch: 0.3, hL: [0.15, 1.2, 0.25], eL: [0.6, -1, 0], hR: [-0.12, 1.18, 0.22], eR: [-0.6, -1, 0], fist: 0.4 }),
  // dizzy "finish them" stagger
  dizzyA: P({ look: 0, rx: -0.1, hip: [0.06, -0.16, -0.02], hipYaw: -0.2, hipRoll: 0.12, spPitch: 0.3, spRoll: 0.15, hdPitch: 0.45, hdRoll: 0.35, hdYaw: 0.2, hL: [0.36, 1.05, 0.12], eL: [0.6, -1, -0.2], hR: [-0.32, 1.02, 0.08], eR: [-0.6, -1, -0.2], fL: [0.2, 0.15, 0.2], fR: [-0.2, 0.15, -0.2], ftRy: -0.3, fist: 0.2 }),
  dizzyB: P({ look: 0, rx: -0.06, hip: [-0.06, -0.14, 0.0], hipYaw: -0.35, hipRoll: -0.12, spPitch: 0.25, spRoll: -0.15, hdPitch: 0.35, hdRoll: -0.3, hdYaw: 0.5, hL: [0.34, 1.0, 0.16], eL: [0.6, -1, -0.2], hR: [-0.34, 1.04, 0.04], eR: [-0.6, -1, -0.2], fL: [0.2, 0.15, 0.22], fR: [-0.2, 0.15, -0.2], ftRy: -0.3, fist: 0.2 }),
  // magic
  charge: P({ rx: 0.05, hip: [0, -0.18, -0.03], hipYaw: -0.2, spPitch: 0.1, spYaw: 0.05, hdYaw: 0.2, hL: [0.1, 1.3, 0.12], eL: [0.8, -0.6, 0], hR: [-0.08, 1.28, 0.1], eR: [-0.8, -0.6, 0], fL: [0.22, 0.15, 0.3], fR: [-0.2, 0.15, -0.32], fist: 0.1 }),
  push: P({ rx: 0.22, hip: [0, -0.12, 0.04], hipYaw: -0.1, spPitch: 0.12, spYaw: 0.05, hdYaw: 0.1, hL: [0.1, 1.5, 0.75], eL: [0.6, -0.8, 0], hR: [-0.06, 1.46, 0.75], eR: [-0.6, -0.8, 0], fL: [0.22, 0.15, 0.45], fR: [-0.2, 0.15, -0.3], fist: 0 }),
  // throw (shuriken / kunai)
  throwWind: P({ rx: 0.05, hipYaw: -0.85, spYaw: -0.4, spPitch: -0.05, hdYaw: 0.9, hR: [-0.32, 1.72, -0.25], eR: [-1, 0, -0.5], hL: [0.3, 1.45, 0.45], fist: 0.8 }),
  throwRel: P({ rx: 0.15, hipYaw: 0.25, spYaw: 0.35, spPitch: 0.2, hdYaw: -0.2, hR: [0.05, 1.5, 0.75], eR: [-1, -0.2, 0], hL: [0.25, 1.3, -0.05], fL: [0.17, 0.15, 0.42], fist: 0.3 }),
  // victory
  winFist: P({ look: 0, rx: 0.0, hip: [0, -0.03, 0], hipYaw: -0.15, spYaw: 0, spPitch: -0.05, hdYaw: 0.15, hdPitch: -0.2, hR: [-0.12, 2.35, 0.15], eR: [-1, 0, 0.3], hL: [0.25, 1.35, 0.2], fL: [0.15, 0.15, 0.2], fR: [-0.15, 0.15, -0.2], ftRy: -0.3 }),
  bow: P({ look: 0, hip: [0, -0.05, -0.05], hipYaw: -0.1, hipPitch: 0.35, spPitch: 0.35, hdPitch: 0.3, hdYaw: 0.1, hL: [0.1, 1.25, 0.25], eL: [1, -0.5, 0], hR: [-0.08, 1.24, 0.25], eR: [-1, -0.5, 0], fL: [0.12, 0.15, 0.05], fR: [-0.12, 0.15, -0.05], ftRy: 0, fist: 0.5 }),
  // knock-down
  launch: P({ look: 0, rx: -0.45, ry: 0.35, tumble: -0.7, hipPitch: -0.2, spPitch: -0.4, hdPitch: -0.6, hL: [0.5, 1.9, 0.2], eL: [1, 0, 0], hR: [-0.5, 1.95, 0.1], eR: [-1, 0, 0], fL: [0.2, 0.5, 0.45], kL: [0, 0.3, 1], fR: [-0.2, 0.25, 0.25], kR: [0, 0.3, 1], ftLp: 0.6, ftRp: 0.6, fist: 0 }),
  fall: P({ look: 0, rx: -0.85, ry: -0.35, tumble: -1.45, hipPitch: -0.1, spPitch: -0.15, hdPitch: -0.3, hL: [0.6, 1.6, -0.2], eL: [1, 0, 0], hR: [-0.6, 1.62, -0.25], eR: [-1, 0, 0], fL: [0.2, 0.4, 0.5], kL: [0, 0.5, 1], fR: [-0.2, 0.3, 0.45], kR: [0, 0.5, 1], ftLp: 0.7, ftRp: 0.7, fist: 0 }),
  down: P({ look: 0, rx: -0.95, ry: -0.72, tumble: -1.57, hip: [0, -0.05, 0], hipYaw: 0, hipPitch: 0, spYaw: 0, spPitch: 0, hdYaw: 0.3, hdPitch: 0.15, hL: [0.62, 1.4, 0.06], eL: [1, 0, 0], hR: [-0.6, 1.5, 0.06], eR: [-1, 0, 0], fL: [0.25, 0.18, 0.12], kL: [0.3, 0, 1], fR: [-0.22, 0.12, 0.02], kR: [-0.3, 0, 1], ftLp: 0.9, ftRp: 0.9, ftLy: 0, ftRy: 0, fist: 0 }),
  bounce: P({ look: 0, rx: -1.0, ry: -0.6, tumble: -1.5, hip: [0, -0.05, 0], hipYaw: 0, spYaw: 0, hdPitch: -0.2, hL: [0.65, 1.55, 0.08], eL: [1, 0, 0], hR: [-0.62, 1.6, 0.08], eR: [-1, 0, 0], fL: [0.25, 0.4, 0.4], kL: [0.3, 0, 1], fR: [-0.22, 0.35, 0.3], kR: [-0.3, 0, 1], ftLp: 0.9, ftRp: 0.9, ftLy: 0, ftRy: 0, fist: 0 }),
  kneel: P({ look: 0, hip: [0, -0.55, -0.05], hipYaw: -0.1, hipPitch: 0.1, spPitch: 0.15, hdPitch: 0.2, hL: [0.22, 0.95, 0.35], eL: [1, -0.5, 0], hR: [-0.2, 1.0, 0.1], eR: [-1, -0.5, 0], fL: [0.18, 0.15, 0.35], kL: [0, 0.2, 1], fR: [-0.16, 0.12, -0.45], kR: [0, -1, 0.3], ftRp: 1.2, ftLy: 0, ftRy: 0 }),
};

/** mirror a pose left↔right (the fighter on the right uses the limbs nearer the camera) */
export function mirror(p: Pose): Pose {
  const mx = (v: Target): Target => (typeof v === "string" ? v : [-v[0], v[1], v[2]]);
  const m3 = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];
  return {
    ...p, roll: -p.roll, spin: -p.spin, hip: m3(p.hip), hipYaw: -p.hipYaw, hipRoll: -p.hipRoll, spYaw: -p.spYaw, spRoll: -p.spRoll, hdYaw: -p.hdYaw, hdRoll: -p.hdRoll,
    hL: mx(p.hR), hR: mx(p.hL), eL: m3(p.eR), eR: m3(p.eL), fL: mx(p.fR), fR: mx(p.fL), kL: m3(p.kR), kR: m3(p.kL),
    ftLy: -p.ftRy, ftRy: -p.ftLy, ftLp: p.ftRp, ftRp: p.ftLp, wR: m3(p.wL), wL: m3(p.wR), uR: m3(p.uL), uL: m3(p.uR),
  };
}
export const mirrorLimb = (l: Limb): Limb => (l[1] === "L" ? (l[0] + "R") : (l[0] + "L")) as Limb;

// ── actions ───────────────────────────────────────────────────────────────────
export const ACTIONS: Record<string, ActionDef> = {
  stance: { name: "stance", loop: true, keys: [{ t: 0, p: "stance" }, { t: 0.32, p: "bob", e: "io" }, { t: 0.64, p: "stance", e: "io" }] },
  tired: { name: "tired", loop: true, keys: [{ t: 0, p: "stance" }, { t: 0.24, p: { ...POSES.bob, hip: [0, -0.15, 0], spPitch: 0.16 }, e: "io" }, { t: 0.48, p: "stance", e: "io" }] },
  jabCross: {
    name: "jabCross", offensive: true, next: "stance",
    keys: [{ t: 0.08, p: "jabWind", e: "out" }, { t: 0.16, p: "jab", e: "snap" }, { t: 0.3, p: "jabBack", e: "io" }, { t: 0.38, p: "crossWind", e: "io" }, { t: 0.47, p: "cross", e: "snap" }, { t: 0.78, p: "stance", e: "io" }],
    ev: [[0.16, { k: "hit", limb: "hL", power: 1 }], [0.47, { k: "hit", limb: "hR", power: 2 }]],
  },
  roundhouse: {
    name: "roundhouse", offensive: true, next: "stance",
    keys: [{ t: 0.14, p: "chamber", e: "out" }, { t: 0.3, p: "kickHigh", e: "snap" }, { t: 0.55, p: "kickBack", e: "io" }, { t: 0.85, p: "stance", e: "io" }],
    ev: [[0.3, { k: "hit", limb: "fR", power: 3 }]],
  },
  uppercut: {
    name: "uppercut", offensive: true, next: "stance",
    keys: [{ t: 0.08, p: "jabWind", e: "out" }, { t: 0.15, p: "jab", e: "snap" }, { t: 0.26, p: "crouch", e: "io" }, { t: 0.38, p: "uppercut", e: "snap" }, { t: 0.5, p: "upFollow", e: "out" }, { t: 0.82, p: "stance", e: "io" }],
    ev: [[0.15, { k: "hit", limb: "hL", power: 1 }], [0.38, { k: "hit", limb: "hR", power: 3 }]],
  },
  bodyKick: {
    name: "bodyKick", offensive: true, next: "stance",
    keys: [{ t: 0.12, p: "chamber", e: "out" }, { t: 0.26, p: "kickMid", e: "snap" }, { t: 0.42, p: "kickBack", e: "io" }, { t: 0.5, p: "crossWind", e: "io" }, { t: 0.58, p: "cross", e: "snap" }, { t: 0.9, p: "stance", e: "io" }],
    ev: [[0.26, { k: "hit", limb: "fR", power: 2, at: "CHEST" }], [0.58, { k: "hit", limb: "hR", power: 2 }]],
  },
  block: { name: "block", next: "stance", guard: [0, 1.25], keys: [{ t: 0.1, p: "block", e: "out" }, { t: 1.25, p: "block" }, { t: 1.45, p: "stance", e: "io" }] },
  blockHit: { name: "blockHit", next: "stance", guard: [0, 0.9], keys: [{ t: 0.05, p: "blockPush", e: "snap" }, { t: 0.3, p: "block", e: "io" }, { t: 0.9, p: "block" }, { t: 1.1, p: "stance", e: "io" }] },
  hitLight: { name: "hitLight", next: "stance", keys: [{ t: 0.06, p: "hitHead", e: "snap" }, { t: 0.42, p: "stance", e: "io" }] },
  hitHeavy: { name: "hitHeavy", next: "stance", keys: [{ t: 0.07, p: "hitHeavy", e: "snap" }, { t: 0.3, p: { ...POSES.hitHeavy, rx: -0.4 }, e: "out" }, { t: 0.7, p: "stance", e: "io" }] },
  hitBody: { name: "hitBody", next: "stance", keys: [{ t: 0.07, p: "hitBody", e: "snap" }, { t: 0.55, p: "stance", e: "io" }] },
  dizzy: { name: "dizzy", loop: true, keys: [{ t: 0, p: "dizzyA" }, { t: 0.8, p: "dizzyB", e: "io" }, { t: 1.6, p: "dizzyA", e: "io" }] },
  cast: {
    name: "cast", offensive: true, next: "stance",
    keys: [{ t: 0.2, p: "charge", e: "out" }, { t: 0.36, p: "charge" }, { t: 0.44, p: "push", e: "snap" }, { t: 0.85, p: "stance", e: "io" }],
    ev: [[0.02, { k: "charge", limb: "hR" }], [0.44, { k: "proj", what: "orb", from: "hR", dur: 0.28, power: 2 }]],
  },
  starThrow: {
    name: "starThrow", offensive: true, next: "stance",
    keys: [{ t: 0.14, p: "throwWind", e: "out" }, { t: 0.22, p: "throwRel", e: "snap" }, { t: 0.3, p: "throwWind", e: "io" }, { t: 0.38, p: "throwRel", e: "snap" }, { t: 0.75, p: "stance", e: "io" }],
    ev: [[0.22, { k: "proj", what: "shuriken", from: "hR", dur: 0.16, power: 1, n: 2, gap: 0.05 }], [0.38, { k: "proj", what: "shuriken", from: "hR", dur: 0.16, power: 2 }]],
  },
  vanish: {
    name: "vanish", offensive: true, next: "stance",
    keys: [{ t: 0.08, p: { ...POSES.crouch, rx: 0 }, e: "out" }, { t: 0.14, p: { ...POSES.crouch, rx: 0 } }, { t: 0.15, p: { ...POSES.chamber, rx: 2.15, spin: Math.PI } }, { t: 0.3, p: { ...POSES.chamber, rx: 2.0, spin: Math.PI } },
      { t: 0.4, p: { ...POSES.kickMid, fR: "OPP_CHEST", rx: 1.95, spin: Math.PI }, e: "snap" }, { t: 0.62, p: { ...POSES.kickBack, rx: 2.05, spin: Math.PI }, e: "io" }, { t: 0.66, p: { ...POSES.stance, rx: 2.1, spin: Math.PI } }, { t: 0.67, p: "stance" }, { t: 0.9, p: "stance" }],
    ev: [[0.1, { k: "smoke" }], [0.12, { k: "vis", on: false }], [0.17, { k: "vis", on: true }], [0.17, { k: "smoke" }], [0.4, { k: "hit", limb: "fR", power: 2, at: "CHEST" }], [0.62, { k: "smoke" }], [0.64, { k: "vis", on: false }], [0.68, { k: "vis", on: true }], [0.68, { k: "smoke" }]],
  },
  winFist: { name: "winFist", keys: [{ t: 0.35, p: "winFist", e: "out" }, { t: 0.9, p: { ...POSES.winFist, hR: [-0.1, 2.38, 0.18] }, e: "io" }] },
  bow: { name: "bow", keys: [{ t: 0.3, p: "tall", e: "io" }, { t: 0.8, p: "bow", e: "io" }, { t: 1.6, p: "bow" }, { t: 2.1, p: "tall", e: "io" }] },
  knockdown: { name: "knockdown", keys: [{ t: 0.06, p: "launch", e: "snap" }, { t: 0.4, p: "fall", e: "lin" }, { t: 0.56, p: "down", e: "in" }, { t: 0.7, p: "bounce", e: "out" }, { t: 0.86, p: "down", e: "io" }] },
  collapse: { name: "collapse", keys: [{ t: 0.3, p: "kneel", e: "in" }, { t: 0.6, p: { ...POSES.down, rx: -0.2, tumble: 1.45, ry: -0.75 }, e: "in" }] },
};

/** the offensive actions per FW move type (picked at random each time) */
export const ATTACKS = ["jabCross", "roundhouse", "uppercut", "bodyKick"];
export const TRICKS = ["starThrow", "vanish"];
