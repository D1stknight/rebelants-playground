// components/fight/stage.ts — the fight engine: two code-driven fighters, contacts/hit-stop/reactions, projectiles,
// weapons, camera requests, the KO → "finish them" → finishing-move flow. Plain three.js; the r3f arena (and the
// offline preview harness) just call update(dt) every frame and render.
import * as THREE from "three";
import { Rig, type Pose, type ResolvedPose, type Vec3 } from "./rig";
import { ACTIONS, ATTACKS, EASE, POSES, P, TRICKS, mirror, mirrorLimb, type ActionDef, type Ev, type Key, type Limb, type WeaponId } from "./moves";
import { FxSystem } from "./fx";
import { makeWeapon, placeWeapon, weaponTip } from "./weapons";

export type Side = "player" | "enemy";
export type FWAnim = "idle" | "attack" | "magic" | "trick" | "defend" | "hit" | "win" | "lose";
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function lerpR(a: ResolvedPose, b: ResolvedPose, u: number): ResolvedPose {
  const o: any = {};
  for (const k in a) { const x = (a as any)[k], y = (b as any)[k]; o[k] = Array.isArray(x) ? x.map((v: number, i: number) => v + (y[i] - v) * u) : x + (y - x) * u; }
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
  constructor(rig: Rig, side: Side, faction: string, color: string) {
    this.rig = rig; this.side = side; this.faction = faction; this.color = color; this.mirrored = side === "enemy";
    rig.root.add(this.extra);
  }
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
    if (id) { const obj = makeWeapon(id, this.color); parent.add(obj); this.weapons[h] = { id, obj }; }
  }
  placeWeapons() {
    const P = this.rig.last; if (!P) return;
    for (const h of ["R", "L"] as const) {
      const w = this.weapons[h]; if (!w) continue;
      w.obj.visible = this.rig.model.visible;
      const dir = this.rig.dirW(h === "R" ? P.wR : P.wL), up = this.rig.dirW(h === "R" ? P.uR : P.uL);
      placeWeapon(w.obj, this.rig.hand(h), dir, up);
    }
  }
  tip(h: "R" | "L") { const w = this.weapons[this.mirrored ? (h === "R" ? "L" : "R") : h]; return w ? weaponTip(w.obj) : this.rig.hand(h); }
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
  | { type: "impact"; target: Side; blocked: boolean; power: number }
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
    if (old) { this.group.remove(old.rig.root); for (const w of Object.values(old.weapons)) if (w) { this.props.remove(w.obj); disposeTree(w.obj); } old.rig.mats.forEach((m) => m.dispose()); }
    const rig = new Rig(model, side === "player" ? -1 : 1, baseX);
    const fi = new Fighter(rig, side, faction, color); this.f[side] = fi; this.group.add(rig.root);
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
    if (m === "wR" || m === "wL") return F.tip(m === "wR" ? "R" : "L");
    return m[0] === "h" ? F.rig.hand(m[1] as "L" | "R") : F.rig.foot(m[1] as "L" | "R");
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
    this.emit({ type: "impact", target: D.side, blocked: false, power });
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
      case "charge": this.follow(this.glowAt(F.color, 0.5), () => F.rig.hand("R").lerp(F.rig.hand("L"), 0.5), 0.45); break;
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
      F.rig.apply(pose, this.hitstop > 0 ? F.shake : 0);
      F.placeWeapons();
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
      return fx.trail(() => { const tip = F.tip(hand); const base = F.rig.hand(h as "L" | "R"); return [base.lerp(tip, 0.62), tip]; }, color, 9);
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
