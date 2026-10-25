// components/fight/stage.ts — the fight engine: two code-driven fighters, contacts/hit-stop/reactions, projectiles,
// weapons, camera requests, the KO → "finish them" → finishing-move flow. Plain three.js; the r3f arena (and the
// offline preview harness) just call update(dt) every frame and render.
import * as THREE from "three";
import { Rig, type Pose, type ResolvedPose, type Vec3 } from "./rig";
import { ACTIONS, ATTACKS, EASE, POSES, P, TRICKS, mirror, mirrorLimb, type ActionDef, type Ev, type Key, type Limb, type WeaponId } from "./moves";
import { FxSystem } from "./fx";
import { makeWeapon, placeWeapon, weaponTip } from "./weapons";
import { Glove, GLOVE_COLORS } from "./glove";

export type Side = "player" | "enemy";
export type FWAnim = "idle" | "attack" | "magic" | "trick" | "defend" | "hit" | "win" | "lose";
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function lerpR(a: ResolvedPose, b: ResolvedPose, u: number): ResolvedPose {
  const o: any = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = (a as any)[k], y = (b as any)[k];
    if (typeof x === "number" && typeof y === "number") o[k] = x + (y - x) * u;
    else if (Array.isArray(x) && Array.isArray(y)) o[k] = x.map((v: number, i: number) => v + (y[i] - v) * u);
    else o[k] = u < 0.5 ? (x ?? y) : (y ?? x);   // strings / booleans / missing: the nearer key's, else whichever exists
  }
  return o;
}
const poseOf = (p: Key["p"]): Pose => (typeof p === "string" ? POSES[p] || POSES.stance : P(p));
function disposeTree(o: THREE.Object3D) { o.traverse((c: any) => { c.geometry?.dispose?.(); (Array.isArray(c.material) ? c.material : c.material ? [c.material] : []).forEach((m: any) => m.dispose?.()); }); }

export class Fighter {
  rig: Rig; side: Side; faction: string; color: string; mirrored: boolean;
  act: { def: ActionDef; t: number; from: ResolvedPose | null; fired: Set<number>; started: number } | null = null;
  weapons: Partial<Record<"R" | "L", { id: WeaponId; obj: THREE.Group }>> = {};
  flash = 0; shake = 0; state: "fight" | "ko" | "finishing" | "done" = "fight";
  look: "none" | "stone" | "gold" | "char" | "glow" = "none"; lookK = 0; lookColor = "#fff"; opacity = 1;
  extra = new THREE.Group();     // props that move with the fighter
  gloves: Record<"R" | "L", Glove>;
  poleK: Record<"R" | "L", number | null> = { R: null, L: null };
  lastPole: Record<"R" | "L", number> = { R: 0, L: 0 }; private lastPoleNext = 0;   // where a support hand holds a long shaft (smoothed)
  constructor(rig: Rig, side: Side, faction: string, color: string, props: THREE.Object3D) {
    this.rig = rig; this.side = side; this.faction = faction; this.color = color; this.mirrored = side === "enemy";
    rig.root.add(this.extra);
    // Universe gloves: the sculpted hands shrink into the cuffs, five-finger gloves grip the weapons
    // the glove keeps the colour of the hand that was sculpted for this fighter (so it never melts into the armour), the cuff the faction's trim
    const [gc0, cc] = GLOVE_COLORS[faction] || ["#2a2a30", color]; const gc = rig.cal.handColor || gc0;
    // sized like the model's own sculpted hands (wrist → middle fingertip ≈ .95 L), cuff as thick as its wrist
    const L = Math.min(0.31, Math.max(0.19, rig.cal.handLen / 0.95)); const cuffK = Math.min(1.2, Math.max(0.9, rig.cal.wristR / (0.16 * L)));
    this.gloves = { R: new Glove("R", L, gc, cc, cuffK), L: new Glove("L", L, gc, cc, cuffK) };
    props.add(this.gloves.R.root, this.gloves.L.root, this.gloves.R.cuff, this.gloves.L.cuff);
    rig.hideHands();
    rig.strikeInset = (this.gloves.R.knuckles.x) * L;
  }
  disposeGloves(props: THREE.Object3D) { for (const g of [this.gloves.R, this.gloves.L]) { props.remove(g.root, g.cuff); g.dispose(); } }
  get acting() { return this.act?.def.name; }
  get offensive() { return !!this.act?.def.offensive && this.act.t < this.lastKeyT(this.act.def); }
  lastKeyT(d: ActionDef) { return d.keys[d.keys.length - 1].t; }
  get guarding() { const a = this.act; return !!a?.def.guard && a.t >= a.def.guard[0] && a.t <= a.def.guard[1]; }
  play(def: ActionDef | string, opts: { keepFrom?: boolean } = {}) {
    const d = typeof def === "string" ? ACTIONS[def] : def; if (!d) return;
    if (this.state === "fight" && !this.rig.visible) { this.rig.visible = true; this.rig.model.visible = true; } // a vanish cut short
    this.act = { def: d, t: 0, from: this.rig.last, fired: new Set(), started: performance.now() };
    void opts;
  }
  limb(l: Limb): Limb { return this.mirrored ? mirrorLimb(l) : l; }
  private pose(p: Key["p"]) { const q = poseOf(p); return this.rig.resolve(this.mirrored ? mirror(q) : q); }
  /** advance; returns events that fired */
  update(dt: number): Ev[] {
    const out: Ev[] = []; const a = this.act; if (!a) return out;
    a.t += dt; const d = a.def; const end = this.lastKeyT(d);
    if (d.ev) d.ev.forEach(([t, e], i) => { if (!a.fired.has(i) && a.t >= t) { a.fired.add(i); out.push(e); } });
    if (a.t > end) {
      if (d.loop && end > 0) { a.t = a.t % end; a.fired.clear(); }
      else if (d.next) { const nx = ACTIONS[d.next]; this.act = { def: nx, t: 0, from: this.sample(), fired: new Set(), started: performance.now() }; }
    }
    return out;
  }
  sample(): ResolvedPose {
    const a = this.act; if (!a) return this.pose("stance");
    const ks = a.def.keys; const t = Math.min(a.t, this.lastKeyT(a.def));
    if (t <= ks[0].t) { const k0 = this.pose(ks[0].p); if (!a.from || ks[0].t <= 0) return k0; return lerpR(a.from, k0, EASE[ks[0].e || "io"](ks[0].t > 0 ? t / ks[0].t : 1)); }
    for (let i = 0; i < ks.length - 1; i++) { const k1 = ks[i + 1]; if (t <= k1.t) { const k0 = ks[i]; const u = k1.t > k0.t ? (t - k0.t) / (k1.t - k0.t) : 1; return lerpR(this.pose(k0.p), this.pose(k1.p), EASE[k1.e || "io"](u)); } }
    return this.pose(ks[ks.length - 1].p);
  }
  setWeapon(hand: "R" | "L", id: WeaponId | null, parent: THREE.Object3D) {
    const h = this.mirrored ? (hand === "R" ? "L" : "R") : hand;
    const cur = this.weapons[h]; if (cur) { parent.remove(cur.obj); disposeTree(cur.obj); delete this.weapons[h]; }
    if (id) { const obj = makeWeapon(id, this.color, this.mirrored); parent.add(obj); this.weapons[h] = { id, obj }; }
    this.rig.gripOff[h] = id ? ((this.weapons[h]!.obj.userData.grip2 as number) ?? -0.14) : -0.14;
  }
  /** gloves on the wrists; a weapon hand closes round its handle, a support hand finds the same handle, free hands follow the fist value */
  placeHands() {
    const R = this.rig, P = R.last; if (!P) return; const vis = R.model.visible;
    const W = (h: "R" | "L") => R.dirW(h === "R" ? P.wR : P.wL), U = (h: "R" | "L") => R.dirW(h === "R" ? P.uR : P.uL);
    // fingers across the handle, turned toward the forearm as far as a real grip allows (the handle runs up to 35° across the palm)
    const perp = (fa: THREE.Vector3, w: THREE.Vector3, F: THREE.Vector3) => {
      const x = fa.clone().addScaledVector(w, -fa.dot(w)); if (x.lengthSq() < 1e-4) x.copy(F).addScaledVector(w, -F.dot(w)); x.normalize();
      const a = Math.acos(Math.min(1, Math.max(-1, x.dot(fa)))); const t = Math.min(a, 0.61); const sg = Math.sign(fa.dot(w)) || 1;
      return x.multiplyScalar(Math.cos(t)).addScaledVector(w, sg * Math.sin(t)).normalize();
    };
    const done = { R: false, L: false };
    for (const h of ["R", "L"] as const) {
      const wp = this.weapons[h]; if (!wp) continue; const g = this.gloves[h];
      const f = R.handFrame(h); const w = W(h);
      g.setCurl(0, true); g.place(f.wrist, perp(f.fa, w, f.F), w, f.fa);
      placeWeapon(wp.obj, g.world(g.gripCenter), w, U(h)); wp.obj.visible = vis;
      const saya = wp.obj.userData.saya as THREE.Object3D | undefined; if (saya) saya.visible = (P.sh ?? 0) > 0.5;
      done[h] = true;
    }
    for (const h of ["R", "L"] as const) {
      if (done[h]) continue; const o = h === "R" ? "L" : "R"; const wp = this.weapons[o];
      const grips = Number(h === "L" ? P.gripL : P.gripR) > 0.5;
      if (!grips || !wp) continue;
      const g = this.gloves[h]; const w = W(o);
      // long shafts (spear, naginata, staff, teppo) can be held anywhere: slide the support hand to where this arm reaches
      let k = R.gripOff[o];
      if (Math.abs(k) >= 0.3) {
        const sh = R.b[(h === "R" ? "Right" : "Left") + "Arm"].getWorldPosition(new THREE.Vector3()); const reachLen = R.cal.arm * 0.95;
        let best = Infinity; const k0 = k, sgn = Math.sign(k0);
        for (let kk = 0.15; kk <= 1.05; kk += 0.05) { const pt = wp.obj.position.clone().addScaledVector(w, sgn * kk); const d = pt.distanceTo(sh);
          const sc = Math.max(0, d - reachLen) * 10 + Math.max(0, 0.25 - d) * 10 + Math.abs(sgn * kk - k0) * 0.4; if (sc < best) { best = sc; k = sgn * kk; } }
        this.poleK[h] = this.poleK[h] == null ? k : this.poleK[h]! + (k - this.poleK[h]!) * 0.35; k = this.poleK[h]!;
      } else this.poleK[h] = null;
      const handle = wp.obj.position.clone().addScaledVector(w, k);
      let f = R.handFrame(h); g.setCurl(0, true);
      // pick the elbow that brings the forearm across the handle (a straight wrist), then settle the grip in two passes
      const authored = (h === "R" ? P.eR : P.eL) as [number, number, number]; const sx = h === "R" ? -1 : 1;
      const poles: [number, number, number][] = [authored, [sx, -0.6, 0], [0, -1, 0.2], [sx * 0.6, -0.6, -0.6], [sx * 0.4, 0.2, -1]];
      let bestPole = authored, bestS = Infinity;
      for (const pl of poles) {
        g.place(f.wrist, perp(f.fa, w, f.F), w, f.fa); const off0 = g.world(g.gripCenter).sub(f.wrist);
        R.reach(h, handle.clone().sub(off0), pl); const ff = R.handFrame(h);
        const pi = poles.indexOf(pl); const sc = Math.abs(ff.fa.dot(w)) + (pi === 0 ? 0 : 0.15) - (this.lastPole[h] === pi ? 0.12 : 0) + ff.wrist.distanceTo(handle.clone().sub(off0)) * 4;
        if (sc < bestS) { bestS = sc; bestPole = pl; this.lastPoleNext = pi; }
        f = R.handFrame(h);
      }
      this.lastPole[h] = this.lastPoleNext;
      for (let it = 0; it < 2; it++) {
        g.place(f.wrist, perp(f.fa, w, f.F), w, f.fa); const off = g.world(g.gripCenter).sub(f.wrist);
        R.reach(h, handle.clone().sub(off), bestPole); f = R.handFrame(h);
      }
      g.place(f.wrist, perp(f.fa, w, f.F), w, f.fa);
      // close the last few cm onto the handle, but never pull the glove off the wrist
      const gap = handle.sub(g.world(g.gripCenter)); const gl = gap.length(); if (gl > 0.035) gap.multiplyScalar(0.035 / gl);
      g.root.position.add(gap); g.root.updateMatrixWorld(true);
      done[h] = true;
    }
    // free hands: a straight wrist (fingers along the forearm), the thumb where the arm's roll puts it
    for (const h of ["R", "L"] as const) { if (done[h]) continue; const g = this.gloves[h]; const f = R.handFrame(h); g.setCurl(P.fist, false); g.place(f.wrist, f.fa.clone().lerp(f.F, 0.15).normalize(), f.T, f.fa); }
    // weapon strikes: the tip stops on the target's surface (no blade / staff through the body); corrects next frame through rig.assistX
    { const tw = Math.min(1, Number(P.tipW) || 0), opp = R.opp, wp = this.weapons[this.mirrored ? "L" : "R"]; let goal = 0;
      if (tw > 0.01 && P.tipAt && opp && wp) {
        const tip = weaponTip(wp.obj), dir = tip.clone().sub(wp.obj.position).normalize();
        const surf = ({ HEAD: 0.11, CHEST: 0.15, BELLY: 0.15, LEGS: 0.1 } as Record<string, number>)[P.tipAt] ?? 0.12;
        const want = opp.part(P.tipAt).addScaledVector(dir, -surf); const fx = Math.sign(opp.root.position.x - R.root.position.x) || 1;
        goal = Math.max(-0.5, Math.min(0.5, R.assistX - (tip.x - want.x) * fx)) * tw;
      }
      const prev = R.assistX; R.assistX += (goal - R.assistX) * (tw > 0.01 ? 1 : 0.25); if (Math.abs(R.assistX) < 1e-4) R.assistX = 0;
      // this frame too: move the fighter, gloves and weapons together (the next pose already includes it)
      const dx = (R.assistX - prev) * (R.opp ? Math.sign(R.opp.root.position.x - R.root.position.x) || -R.side : 0);
      if (dx) { R.root.position.x += dx; R.root.updateMatrixWorld(true);
        for (const h of ["R", "L"] as const) { for (const o of [this.gloves[h].root, this.gloves[h].cuff]) { o.position.x += dx; o.updateMatrixWorld(true); } const w = this.weapons[h]; if (w) w.obj.position.x += dx; } } }
    // bow + arrow: the arrow lies from the nock (draw hand) across the bow grip, and the string follows the nock when drawn
    for (const h of ["R", "L"] as const) {
      const bow = this.weapons[h], arr = this.weapons[h === "R" ? "L" : "R"];
      const ends = bow?.obj.userData.stringEnds as THREE.Vector3[] | undefined; if (!bow || !ends) continue;
      const str = bow.obj.userData.string as THREE.Line; const pos = str.geometry.getAttribute("position") as THREE.BufferAttribute;
      let mid = ends[0].clone().lerp(ends[1], 0.5);
      if (arr && arr.id === "arrow" && arr.obj.visible) {
        const nock = arr.obj.position.clone(), grip = bow.obj.position.clone(); const d = grip.clone().sub(nock); const len = d.length();
        if (len > 0.12 && len < 1.0) {
          placeWeapon(arr.obj, nock, d.normalize(), R.dirW([0, 1, 0]));
          bow.obj.updateMatrixWorld(true); const l = bow.obj.worldToLocal(nock.clone());
          if (l.z < mid.z + 0.02 && Math.abs(l.y) < 0.5) mid = l;
        }
      }
      pos.setXYZ(1, mid.x, mid.y, mid.z); pos.needsUpdate = true; str.geometry.computeBoundingSphere();
    }
    for (const g of [this.gloves.R, this.gloves.L]) { g.root.visible = vis; g.cuff.visible = vis; }
  }
  /** the business end of a hand: the weapon's tip, else the glove's knuckles */
  tip(h: "R" | "L") { const a = this.mirrored ? (h === "R" ? "L" : "R") : h; const w = this.weapons[a]; return w ? weaponTip(w.obj) : this.gloves[a].world(this.gloves[a].knuckles); }
  fistAt(actual: "R" | "L") { return this.gloves[actual].world(this.gloves[actual].knuckles); }
  gripAt(actual: "R" | "L") { return this.gloves[actual].world(this.gloves[actual].gripCenter); }
  /** world points spread over the body (for shards / particles) */
  bodyPoints(): THREE.Vector3[] {
    const b = this.rig.b; const names = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand", "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot"];
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < names.length; i++) { const o = b[names[i]]; if (!o) continue; const p = o.getWorldPosition(V()); pts.push(p); const ch = o.children.find((c: any) => c.isBone); if (ch) pts.push(p.clone().lerp(ch.getWorldPosition(V()), 0.5)); }
    pts.push(this.rig.part("HEAD"));
    return pts;
  }
  center() { return this.rig.part("CHEST"); }
}

export type StageEvent =
  | { type: "impact"; target: Side; blocked: boolean; power: number; gap?: number }
  | { type: "shake"; amount: number }
  | { type: "screenFlash"; color: string; strength: number }
  | { type: "title"; text: string; color: string; sub?: string }
  | { type: "finisherStart"; side: Side; id: string; name: string }
  | { type: "finisherEnd"; side: Side; id: string }
  | { type: "ko"; side: Side };

export interface CamShot { pos: THREE.Vector3; look: THREE.Vector3; fov?: number; ease?: number }

export class FightStage {
  group = new THREE.Group();
  fx = new FxSystem();
  props = new THREE.Group();
  f: Partial<Record<Side, Fighter>> = {};
  hitstop = 0; timeScale = 1; private slowLeft = 0;
  cam: CamShot | null = null;
  private listeners: ((e: StageEvent) => void)[] = [];
  private followers: { o: THREE.Object3D; fn: () => THREE.Vector3 | null; life: number }[] = [];
  fin: { side: Side; def: import("./finishers").Finisher; t: number; fired: Set<number>; resolve: () => void } | null = null;
  koSide: Side | null = null;
  rand = Math.random;

  constructor() { this.group.add(this.fx.group); this.group.add(this.props); }
  on(fn: (e: StageEvent) => void) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((x) => x !== fn); }; }
  emit(e: StageEvent) { for (const l of this.listeners) l(e); }
  other(s: Side): Side { return s === "player" ? "enemy" : "player"; }

  setFighter(side: Side, model: THREE.Object3D, faction: string, color: string, baseX = 0.78) {
    const old = this.f[side];
    if (old) { this.group.remove(old.rig.root); for (const w of Object.values(old.weapons)) if (w) { this.props.remove(w.obj); disposeTree(w.obj); } old.rig.mats.forEach((m) => m.dispose()); old.disposeGloves(this.props); }
    const rig = new Rig(model, side === "player" ? -1 : 1, baseX);
    const fi = new Fighter(rig, side, faction, color, this.props); this.f[side] = fi; this.group.add(rig.root);
    const o = this.f[this.other(side)]; if (o) { rig.opp = o.rig; o.rig.opp = rig; }
    fi.play("stance"); fi.act!.t = this.rand() * 0.6; fi.act!.from = null;
    this.koSide = null; this.fin = null; this.cam = null; this.timeScale = 1; this.hitstop = 0;
    this.fx.clear(); this.timers = []; for (const f of this.followers) this.props.remove(f.o); this.followers = []; // new match-up: no leftovers
    if (o) { o.state = "fight"; o.opacity = 1; o.rig.offset.set(0, 0, 0); o.rig.offsetSpin = 0; o.rig.visible = true; o.rig.setOpacity(1); o.rig.model.visible = true; o.rig.tint("none"); o.look = "none"; if (o.act?.def.name !== "stance") o.play("stance"); for (const h of ["R", "L"] as const) o.setWeapon(h, null, this.props); }
    return fi;
  }

  // ── game → engine ───────────────────────────────────────────────────────────
  play(side: Side, anim: FWAnim) {
    const F = this.f[side]; if (!F) return; const O = this.f[this.other(side)];
    if (F.state !== "fight") return;                             // KO'd / finishing: the game's win/lose/idle no longer drive it
    if (this.koSide && anim !== "win") return;
    switch (anim) {
      case "attack": F.play(ATTACKS[Math.floor(this.rand() * ATTACKS.length)]); break;
      case "magic": F.play("cast"); break;
      case "trick": F.play(TRICKS[Math.floor(this.rand() * TRICKS.length)]); break;
      case "defend": F.play("block"); break;
      case "hit": { if (O?.offensive) return; if (F.offensive) return; F.play("hitLight"); break; }
      case "idle": if (!F.offensive && F.acting !== "block" && F.acting !== "blockHit" && !/^hit/.test(F.acting || "")) F.play("stance"); break;
      case "win": if (!this.fin && !this.koSide) F.play("winFist"); break;
      case "lose": if (!this.koSide) F.play("collapse"); break;
    }
  }
  /** HP reached 0 on this side: stagger, waiting for the finishing move */
  ko(side: Side) {
    const F = this.f[side]; if (!F || this.koSide) return;
    this.koSide = side; F.state = "ko";
    const go = () => { if (F.state === "ko") F.play("dizzy"); };
    if (F.act && !F.act.def.loop && F.act.t < F.lastKeyT(F.act.def)) this.later(F.lastKeyT(F.act.def) - F.act.t + 0.02, go); else go();
    const W = this.f[this.other(side)]; if (W && !W.offensive) W.play("stance");
    this.slow(0.35, 0.6);
    this.emit({ type: "ko", side });
  }
  slow(scale: number, dur: number) { this.timeScale = scale; this.slowLeft = dur; }
  stop(sec: number) { this.hitstop = Math.max(this.hitstop, sec); }

  // ── contacts ───────────────────────────────────────────────────────────────
  limbPos(F: Fighter, l: Limb): THREE.Vector3 {
    const m = F.limb(l);
    if (m === "wR" || m === "wL") { const a = m === "wR" ? "R" : "L"; const w = F.weapons[a]; return w ? weaponTip(w.obj) : F.fistAt(a); }
    return m[0] === "h" ? F.fistAt(m[1] as "L" | "R") : F.rig.foot(m[1] as "L" | "R");
  }
  contact(attacker: Side, at: THREE.Vector3, power: 1 | 2 | 3, part: "HEAD" | "CHEST" | "BELLY" = "HEAD", opts: { noReact?: boolean; color?: string } = {}) {
    const A = this.f[attacker], D = this.f[this.other(attacker)]; if (!A || !D) return;
    const target = D.rig.part(part); const pos = at.clone().lerp(target, 0.35);
    if (D.guarding && D.state === "fight") {
      this.fx.impact(pos, "#8fd0ff", 1, true); D.play("blockHit"); this.stop(0.06); D.shake = 0.02;
      this.emit({ type: "impact", target: D.side, blocked: true, power }); this.emit({ type: "shake", amount: 0.4 }); return;
    }
    this.fx.impact(pos, opts.color || A.color, power); D.flash = 0.1 + power * 0.03; D.shake = 0.02 + power * 0.012;
    this.stop([0, 0.05, 0.08, 0.13][power]);
    if (!opts.noReact && D.state === "fight") {
      const trading = D.offensive && D.act && D.act.t < 0.35;
      if (!trading) D.play(part === "CHEST" || part === "BELLY" ? "hitBody" : power >= 2 ? "hitHeavy" : "hitLight");
    }
    this.emit({ type: "impact", target: D.side, blocked: false, power, gap: +at.distanceTo(target).toFixed(3) });
    this.emit({ type: "shake", amount: 0.4 + power * 0.35 });
  }

  private handle(F: Fighter, e: Ev) {
    const O = this.f[this.other(F.side)];
    switch (e.k) {
      case "hit": if (O) this.contact(F.side, this.limbPos(F, e.limb), e.power, e.at || "HEAD"); break;
      case "proj": {
        if (!O) break; const n = e.n || 1;
        for (let i = 0; i < n; i++) {
          const fire = () => {
            const from = this.limbPos(F, e.from);
            const what = e.what; const obj = makeWeapon(what === "orb" ? "orb" : what, F.color);
            const part = what === "orb" ? "CHEST" : i % 2 ? "CHEST" : "HEAD";
            const to = () => O.rig.part(part as any);
            this.fx.projectile(obj, from, to, e.dur, {
              arc: e.arc || 0, spin: what === "shuriken" ? V(0, 0, 40) : undefined, face: what !== "shuriken" && what !== "orb",
              trail: what === "orb" ? F.color : what === "shuriken" ? "#cfe8ff" : undefined,
              arrive: () => this.contact(F.side, to(), (i === n - 1 ? e.power : 1) as 1 | 2 | 3, part as any, { color: F.color }),
            });
            if (what === "orb") { obj.scale.setScalar(1.2); }
            if (what === "shuriken") { obj.lookAt(this.fx.camera ? this.fx.camera.position : V(0, 1, 5)); }
          };
          if (i === 0) fire(); else this.later((e.gap || 0.06) * i, fire);
        }
        break;
      }
      case "weapon": if (e.R !== undefined) F.setWeapon("R", e.R, this.props); if (e.L !== undefined) F.setWeapon("L", e.L, this.props); break;
      case "vis": F.rig.model.visible = e.on; F.rig.visible = e.on; break;
      case "smoke": this.fx.smoke(F.center(), "#7d8496", 10, 0.5); break;
      case "charge": this.follow(this.glowAt(F.color, 0.5), () => F.gripAt("R").lerp(F.gripAt("L"), 0.5), 0.45); break;
      case "whoosh": break;
    }
  }
  glowAt(color: string, size: number) { return this.fx.glowSprite(color, size); }
  private timers: { t: number; fn: () => void }[] = [];
  /** run fn after `sec` of fight time (respects hit-stop / slow-mo) */
  later(sec: number, fn: () => void) { this.timers.push({ t: sec, fn }); }
  /** keep an object at a moving point for a while (charge glows, props in hand) */
  follow(o: THREE.Object3D, fn: () => THREE.Vector3 | null, life: number) { this.props.add(o); this.followers.push({ o, fn, life }); }

  update(dtReal: number) {
    const dt = Math.min(0.05, dtReal);
    if (this.slowLeft > 0) { this.slowLeft -= dt; if (this.slowLeft <= 0) this.timeScale = 1; }
    let sim = dt * this.timeScale;
    if (this.hitstop > 0) { this.hitstop -= dt; sim = 0; }
    if (sim > 0) for (let i = this.timers.length - 1; i >= 0; i--) { const tm = this.timers[i]; tm.t -= sim; if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); } }
    for (const s of ["player", "enemy"] as Side[]) {
      const F = this.f[s]; if (!F) continue;
      const evs = F.update(sim);
      for (const e of evs) this.handle(F, e);
    }
    if (this.fin) this.updateFinisher(sim);
    for (const s of ["player", "enemy"] as Side[]) {
      const F = this.f[s]; if (!F) continue;
      const pose = F.sample();
      F.rig.apply(pose, this.hitstop > 0 ? F.shake : 0, sim);
      F.placeHands();
      if (F.flash > 0) { F.flash -= dt; F.rig.tint("hit"); if (F.flash <= 0) F.rig.tint(F.look === "none" ? "none" : F.look, F.lookColor, F.lookK); }
      else if (F.look !== "none") F.rig.tint(F.look, F.lookColor, F.lookK);
    }
    for (let i = this.followers.length - 1; i >= 0; i--) { const f = this.followers[i]; f.life -= sim; const p = f.fn(); if (p) f.o.position.copy(p); if (f.life <= 0) { this.props.remove(f.o); this.followers.splice(i, 1); } }
    this.fx.update(this.hitstop > 0 ? dt * 0.3 : dt * Math.max(0.35, this.timeScale));
  }

  // ── finishing moves ────────────────────────────────────────────────────────
  runFinisher(side: Side, def: import("./finishers").Finisher): Promise<void> {
    const A = this.f[side], D = this.f[this.other(side)];
    if (!A || !D) return Promise.resolve();
    A.state = "finishing"; D.state = "ko";
    return new Promise((resolve) => {
      this.fin = { side, def, t: 0, fired: new Set(), resolve };
      this.timeScale = 1; this.slowLeft = 0;
      this.emit({ type: "finisherStart", side, id: def.id, name: def.name });
    });
  }
  private updateFinisher(dt: number) {
    const fin = this.fin!; fin.t += dt;
    const A = this.f[fin.side]!, D = this.f[this.other(fin.side)]!;
    const ctx = makeCtx(this, A, D);
    fin.def.steps.forEach(([t, fn], i) => { if (!fin.fired.has(i) && fin.t >= t) { fin.fired.add(i); try { fn(ctx); } catch (err) { console.warn("finisher step", err); } } });
    if (fin.t >= fin.def.dur) {
      const done = fin.resolve; const id = fin.def.id; this.fin = null; this.cam = null; this.timeScale = 1;
      A.state = "done"; for (const h of ["R", "L"] as const) A.setWeapon(h, null, this.props);
      A.play(this.rand() < 0.5 ? "winFist" : "bow");
      this.emit({ type: "finisherEnd", side: fin.side, id }); done();
    }
  }
}

// ── the toolkit finishing moves are written with ────────────────────────────
export interface FinCtx {
  S: FightStage; A: Fighter; D: Fighter; fx: FxSystem;
  /** play keyed poses on a fighter (times in seconds, poses partial over the stance) */
  act: (F: Fighter, keys: Key[], ev?: [number, Ev][], loop?: boolean) => void;
  weapon: (F: Fighter, R?: WeaponId | null, L?: WeaponId | null) => void;
  cam: (shot: "wide" | "closeA" | "closeD" | "low" | "high" | "overA" | "sky" | "side" | CamShot, ease?: number) => void;
  slow: (scale: number, dur: number) => void; stop: (sec: number) => void;
  hit: (power: 1 | 2 | 3, at?: THREE.Vector3, part?: "HEAD" | "CHEST" | "BELLY", color?: string) => void;
  flash: (color?: string, strength?: number) => void; shake: (amount: number) => void;
  title: (text: string, sub?: string) => void;
  /** defender endings */
  end: (how: "shatter" | "petals" | "ash" | "stone" | "gold" | "sky" | "sink" | "dissolve" | "vanish", color?: string) => void;
  look: (F: Fighter, look: Fighter["look"], k: number, color?: string) => void;
  /** a glowing ribbon behind the weapon in hand (or the fist/foot) until stop() */
  trail: (F: Fighter, color: string, hand?: "R" | "L") => { stop: () => void };
  /** fiery / smoky blast */
  explode: (pos: THREE.Vector3, color: string, size?: number) => void;
  sideX: (F: Fighter) => number;   // +1 if F's forward points to +X
  at: (F: Fighter, fwd: number, up: number, side?: number) => THREE.Vector3; // a point relative to F (fighter-forward / up / toward camera)
}
function makeCtx(S: FightStage, A: Fighter, D: Fighter): FinCtx {
  const fx = S.fx;
  const dirX = (F: Fighter) => (F.side === "player" ? 1 : -1);
  const at = (F: Fighter, fwd: number, up: number, side = 0) => { const r = F.rig.root.position; return V(r.x + dirX(F) * fwd, up, r.z + side); };
  const mid = () => A.rig.root.position.clone().lerp(D.rig.root.position, 0.5);
  return {
    S, A, D, fx,
    act: (F, keys, ev, loop) => F.play({ name: "fin", keys, ev, loop }),
    weapon: (F, R, L) => { if (R !== undefined) F.setWeapon("R", R, S.props); if (L !== undefined) F.setWeapon("L", L, S.props); },
    cam: (shot, ease = 4) => {
      if (typeof shot !== "string") { S.cam = { ...shot, ease }; return; }
      const m = mid(); const a = A.rig.root.position, d = D.rig.root.position; const sx = dirX(A);
      const shots: Record<string, CamShot> = {
        wide: { pos: V(m.x, 1.25, 4.6), look: V(m.x, 1.0, 0), fov: 36 },
        closeA: { pos: V(a.x + sx * 1.1, 1.55, 2.3), look: V(a.x, 1.35, 0), fov: 34 },
        closeD: { pos: V(d.x - sx * 1.0, 1.5, 2.3), look: V(d.x, 1.25, 0), fov: 34 },
        low: { pos: V(m.x - sx * 0.6, 0.35, 3.2), look: V(m.x, 1.3, 0), fov: 40 },
        high: { pos: V(m.x, 4.2, 3.4), look: V(m.x, 0.6, 0), fov: 38 },
        overA: { pos: V(a.x - sx * 1.4, 1.9, 1.4), look: V(d.x, 1.2, 0), fov: 38 },
        sky: { pos: V(m.x, 1.1, 5.2), look: V(d.x, 2.4, -1.2), fov: 46 },
        side: { pos: V(m.x, 1.3, 3.4), look: V(m.x, 1.1, 0), fov: 34 },
      };
      S.cam = { ...shots[shot], ease };
    },
    slow: (s, d) => S.slow(s, d), stop: (s) => S.stop(s),
    hit: (power, p, part = "HEAD", color) => S.contact(A.side, p || D.rig.part(part), power, part, { noReact: true, color }),
    flash: (color = "#ffffff", strength = 0.8) => S.emit({ type: "screenFlash", color, strength }),
    shake: (amount) => S.emit({ type: "shake", amount }),
    title: (text, sub) => S.emit({ type: "title", text, color: A.color, sub }),
    look: (F, look, k, color) => { F.look = look; F.lookK = k; if (color) F.lookColor = color; },
    end: (how, color = A.color) => {
      const pts = D.bodyPoints(); const c = D.center();
      const hide = () => { D.rig.model.visible = false; D.rig.visible = false; D.state = "done"; for (const h of ["R", "L"] as const) D.setWeapon(h, null, S.props); };
      switch (how) {
        case "shatter": fx.shards(pts, color, { n: 90, speed: 3.2, from: c, emissive: 0.9 }); fx.flash(c, color, 2.2, 0.35); fx.sparks(c, "#ffffff", 30, 6, 0.5); hide(); break;
        case "petals": fx.motes(pts, "#ffb7c9", "petals", 140, 2.6); fx.flash(c, "#ffd0dc", 1.4, 0.3); hide(); break;
        case "ash": fx.motes(pts, color, "ash", 120, 2.4); fx.motes(pts, "#ff8a3a", "embers", 50, 1.8); hide(); break;
        case "stone": fx.shards(pts, "#8a8278", { n: 70, speed: 1.2, emissive: 0, gravity: 9, size: 0.08, metal: 0 }); fx.dust(D.rig.root.position, 1.2); hide(); break;
        case "gold": fx.shards(pts, "#ffcc55", { n: 80, speed: 2.2, emissive: 0.5, metal: 1 }); fx.flash(c, "#fff1b0", 1.8, 0.35); hide(); break;
        case "dissolve": fx.motes(pts, color, "spirit", 120, 2.2); hide(); break;
        case "vanish": hide(); break;
        case "sky": { const R = D.rig; const vx = -dirX(A) * 2.2;
          fx.animate(new THREE.Object3D(), 1.3, (_o, t) => { R.offset.set(vx * t, 4.6 * t - 0.9 * t * t, -3.2 * t); R.offsetSpin = t * 9; if (t > 1.05 && R.model.visible) { fx.sprite(R.root.position.clone().add(V(0, 1, 0)), "#ffffff", 0.7, 0.8, { tex: "star", grow: 2.2 }); hide(); } });
          D.state = "done"; break; }
        case "sink": { const R = D.rig; fx.animate(new THREE.Object3D(), 1.4, (_o, _t, u) => { R.offset.y = -u * u * 2.6; if (u >= 1) hide(); }); fx.dust(D.rig.root.position, 1.0); D.state = "done"; break; }
      }
    },
    trail: (F, color, hand = "R") => {
      const h = F.mirrored ? (hand === "R" ? "L" : "R") : hand;
      return fx.trail(() => { const tip = F.tip(hand); const base = F.gripAt(h as "L" | "R"); return [base.lerp(tip, 0.62), tip]; }, color, 9);
    },
    explode: (pos, color, size = 1) => {
      fx.flash(pos, "#fff4d0", 2.4 * size, 0.35); fx.flash(pos, color, 3.2 * size, 0.6);
      fx.sparks(pos, "#ffd27a", 40, 7 * size, 0.6); fx.ring(pos, color, 2.6 * size, 0.5); fx.groundRing(pos, color, 3 * size, 0.8);
      for (let i = 0; i < 18; i++) fx.sprite(pos.clone().add(V((Math.random() - 0.5) * 0.6, (Math.random() - 0.3) * 0.6, (Math.random() - 0.5) * 0.6)), i % 2 ? color : "#3a302c", (0.5 + Math.random() * 0.6) * size, 0.8 + Math.random() * 0.6, { tex: "smoke", add: i % 2 === 1, vel: V((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4).multiplyScalar(size), grow: 1.6, fade: 0.8 });
      S.emit({ type: "shake", amount: 2.5 * size }); S.emit({ type: "screenFlash", color: "#fff1d0", strength: 0.7 });
    },
    sideX: dirX, at,
  };
}
