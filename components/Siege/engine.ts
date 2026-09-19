// components/Siege/engine.ts — The Siege, phase 1: the solo drill.
// Side view. Citadel + gate on the left, the horde crosses the plain from the right. One catapult (slingshot aim), planck.js
// physics for boulders / crawlers / silk towers / rams, PixiJS WebGL for drawing with additive VFX (Kenney CC0 textures) + bloom.
// Units: metres, y up in physics; PX px per metre on screen; screen y = (WORLD_H - y) * PX.
import * as PIXI from "pixi.js";
import { AdvancedBloomFilter, ShockwaveFilter } from "pixi-filters";
import * as pl from "planck";

export const WORLD_W = 52, WORLD_H = 22, PX = 28;               // 1456 × 616 css px at scale 1
const GROUND: [number, number][] = [[0, 12], [7.2, 12], [12.2, 7.6], [12.8, 7.6], [12.8, 2.2], [WORLD_W + 4, 2.2]];
const PLAIN_Y = 2.2, GATE = { x0: 12.2, x1: 12.85, y0: 2.2, y1: 7.6 }, CATAPULT = { x: 5.6, y: 12.9 };
const G = 22;                                                     // gravity (m/s²) — a little heavy for snappy arcs

export type Hud = { gate: number; gateMax: number; wave: number; waves: number; horde: number; score: number; kills: number; reload: number; state: "ready" | "play" | "won" | "lost"; msg: string | null };
export type Callbacks = { onHud: (h: Hud) => void; onSfx?: (n: "launch" | "impact" | "crash" | "squish" | "gate" | "horn" | "lose" | "win") => void; onEnd?: (r: { won: boolean; score: number; kills: number; waves: number }) => void };

type Kind = "boulder" | "crawler" | "block" | "towerBase" | "ram" | "wheel" | "ground" | "gate";
type Ent = { id: number; kind: Kind; body: pl.Body; g: PIXI.Container; hp: number; hpMax: number; t: number; dead?: boolean; stun?: number; row?: number; ph?: number; size?: number; tower?: Tower; ram?: Ram };
type Tower = { base: Ent; blocks: Ent[]; arrived: boolean; alive: boolean };
type Ram = { body: Ent; wheels: Ent[]; joints: pl.RevoluteJoint[]; arrived: boolean; alive: boolean };
type Part = { s: PIXI.Sprite; vx: number; vy: number; life: number; life0: number; grow: number; spin: number; g: number; fade: number; size: number };

const WAVES: { crawlers: number; big: number; tower?: number; ram?: number; gap: number }[] = [
  { crawlers: 8, big: 0, gap: 0.9 }, { crawlers: 12, big: 2, gap: 0.7 }, { crawlers: 10, big: 2, tower: 1, gap: 0.7 },
  { crawlers: 16, big: 4, gap: 0.55 }, { crawlers: 14, big: 3, tower: 1, ram: 1, gap: 0.55 }, { crawlers: 22, big: 6, tower: 2, ram: 1, gap: 0.45 },
];
const FX = ["spark", "spark2", "ring", "glow", "flare", "smoke", "smoke2", "fire", "flame", "dirt", "bolt", "bolt2", "star", "slash", "magic", "scorch", "twirl", "muzzle"];

export class Siege {
  app!: PIXI.Application; world!: pl.World; cb: Callbacks; canvas: HTMLCanvasElement; ready = false; over = false;
  ents: Ent[] = []; nextId = 1; towers: Tower[] = []; rams: Ram[] = []; parts: Part[] = []; tex: Record<string, PIXI.Texture> = {};
  // layers
  L = {} as Record<"sky" | "far" | "world" | "fx" | "front", PIXI.Container>;
  scale = 1; ox = 0; oy = 0; t = 0; acc = 0; last = 0;
  // game
  state: Hud["state"] = "ready"; gateHp = 1000; gateMax = 1000; wave = 0; score = 0; kills = 0; msg: string | null = null; msgT = 0;
  spawnQueue: { at: number; fn: () => void }[] = []; waveT = 0; waveDone = false; hordeLeft = 0;
  reload = 0; reloadTime = 1.4; aiming = false; aimStart = { x: 0, y: 0 }; aimNow = { x: 0, y: 0 }; catapultG!: PIXI.Container; armG!: PIXI.Graphics; previewG!: PIXI.Graphics;
  shock!: ShockwaveFilter; shockT = 99; shake = 0; hudT = 0; torches: PIXI.Sprite[] = [];

  constructor(canvas: HTMLCanvasElement, cb: Callbacks) { this.canvas = canvas; this.cb = cb; }

  async init() {
    this.app = new PIXI.Application();
    await this.app.init({ canvas: this.canvas, resizeTo: this.canvas.parentElement || undefined, antialias: true, backgroundAlpha: 1, background: 0x0b0e17, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true, preference: "webgl" });
    for (const n of FX) this.tex[n] = await PIXI.Assets.load(`/siege/fx/${n}.png`);
    for (const k of ["sky", "far", "world", "fx", "front"] as const) { this.L[k] = new PIXI.Container(); this.app.stage.addChild(this.L[k]); }
    const bloom = new AdvancedBloomFilter({ threshold: 0.35, bloomScale: 1.1, brightness: 1.0, blur: 6, quality: 4 }); this.L.fx.filters = [bloom];
    this.shock = new ShockwaveFilter({ center: { x: 0, y: 0 }, amplitude: 22, wavelength: 90, brightness: 1.05, radius: 260, speed: 900, time: 99 }); this.L.world.filters = [this.shock];
    this.buildPhysics(); this.buildScenery(); this.buildCatapult();
    this.fit(); window.addEventListener("resize", this.fitBound); this.app.renderer.on("resize", this.fitBound); requestAnimationFrame(this.fitBound); setTimeout(this.fitBound, 300);
    this.bindInput();
    this.ready = true; this.last = performance.now(); this.app.ticker.add(() => this.frame()); (window as any).__siege = this;   // debug handle
    this.pushHud();
  }
  fitBound = () => this.fit();
  fit() {
    const w = this.app.renderer.width / this.app.renderer.resolution, h = this.app.renderer.height / this.app.renderer.resolution;
    this.scale = Math.min(w / (WORLD_W * PX), h / (WORLD_H * PX)); if (h / w > 0.9) this.scale = w / (WORLD_W * PX);   // portrait: fit width
    this.ox = (w - WORLD_W * PX * this.scale) / 2; this.oy = Math.max(0, (h - WORLD_H * PX * this.scale) / 2);
    for (const k of ["far", "world", "fx", "front"] as const) { this.L[k].scale.set(this.scale); this.L[k].position.set(this.ox, this.oy); }
    this.L.sky.scale.set(Math.max(w / (WORLD_W * PX), h / (WORLD_H * PX))); this.L.sky.position.set(0, 0);
  }
  destroy() { this.over = true; window.removeEventListener("resize", this.fitBound); try { this.app?.destroy(false, { children: true }); } catch {} }

  // ── coordinates
  sx(x: number) { return x * PX; } sy(y: number) { return (WORLD_H - y) * PX; }
  toWorld(px: number, py: number) { return { x: (px - this.ox) / this.scale / PX, y: WORLD_H - (py - this.oy) / this.scale / PX }; }

  // ── physics
  buildPhysics() {
    this.world = new pl.World({ gravity: new pl.Vec2(0, -G) });
    const ground = this.world.createBody({ type: "static" }); ground.createFixture(new pl.Chain(GROUND.map(([x, y]) => new pl.Vec2(x, y)), false), { friction: 0.9 }); ground.setUserData({ kind: "ground" });
    const gate = this.world.createBody({ type: "static", position: new pl.Vec2((GATE.x0 + GATE.x1) / 2, (GATE.y0 + GATE.y1) / 2) }); gate.createFixture(new pl.Box((GATE.x1 - GATE.x0) / 2, (GATE.y1 - GATE.y0) / 2), { friction: 0.6 }); gate.setUserData({ kind: "gate" });
    this.world.on("post-solve", (contact, impulse) => {
      const a = contact.getFixtureA().getBody().getUserData() as any, b = contact.getFixtureB().getBody().getUserData() as any; if (!a || !b) return;
      const imp = Math.max(...(impulse.normalImpulses || [0]));
      this.onImpact(a, b, imp); this.onImpact(b, a, imp);
    });
  }
  onImpact(a: any, b: any, imp: number) {
    const ea: Ent | undefined = a.ent, eb: Ent | undefined = b.ent;
    // boulder hits things
    if (ea?.kind === "boulder" && eb && !eb.dead) {
      if (eb.kind === "crawler") { this.damage(eb, 40 + imp * 6, ea); eb.stun = 1.2; }
      else if (eb.kind === "block") { if (imp > 2.2) this.damage(eb, 30 + imp * 4, ea); }
      else if (eb.kind === "ram") { this.damage(eb, 10 + imp * 3, ea); }
      else if (eb.kind === "towerBase") { this.damage(eb, imp * 2, ea); }
      if (imp > 1.5 && ea.t > 0.05) { const p = ea.body.getPosition(); this.hitFx(p.x, p.y, Math.min(1, imp / 12)); }
    }
    // falling blocks crush crawlers / hit the gate
    if (ea?.kind === "block" && eb?.kind === "crawler" && imp > 1.4 && !eb.dead) { this.damage(eb, imp * 8, ea); eb.stun = 0.8; }
    if (ea?.kind === "block" && b.kind === "gate" && imp > 1.5) { this.hurtGate(imp * 2); }
    // horde at the gate
    if (ea?.kind === "crawler" && b.kind === "gate") { this.hurtGate((ea.size || 1) * 0.35); }
    if (ea?.kind === "ram" && b.kind === "gate" && imp > 3) { this.hurtGate(18); this.shake = 0.8; this.cb.onSfx?.("gate"); const p = ea.body.getPosition(); this.burst(GATE.x1, p.y + 0.3, "dirt", 10, 3, 0.8, 0xb8a48a, 0.25); }
  }
  damage(e: Ent, d: number, by?: Ent) {
    if (e.dead) return; e.hp -= d; if (e.hp > 0) return; e.dead = true;
    const p = e.body.getPosition();
    if (e.kind === "crawler") { this.kills++; this.score += Math.round(10 * (e.size || 1)); this.hordeLeft--; this.burst(p.x, p.y, "dirt", 8, 2.4, 0.7, 0x8b5cf6, 0.22); this.burst(p.x, p.y, "glow", 3, 1.2, 0.4, 0xc4b5fd, 0.5); this.cb.onSfx?.("squish"); }
    else if (e.kind === "block") { this.score += 5; this.burst(p.x, p.y, "smoke2", 4, 1.6, 0.8, 0x7a6a9a, 0.6); this.burst(p.x, p.y, "dirt", 5, 2.5, 0.6, 0xcbbde8, 0.2); }
    else if (e.kind === "ram") { this.score += 150; this.hitFx(p.x, p.y, 1); this.burst(p.x, p.y, "dirt", 24, 4.5, 1.1, 0x9c7a4a, 0.4); this.cb.onSfx?.("crash"); if (e.ram) this.killRam(e.ram); return; }
    else if (e.kind === "towerBase") { return; }
    this.removeEnt(e);
    void by;
  }
  hurtGate(d: number) { if (this.state !== "play") return; this.gateHp = Math.max(0, this.gateHp - d); if (this.gateHp <= 0) this.end(false); }

  // ── entities
  mkEnt(kind: Kind, body: pl.Body, g: PIXI.Container, hp: number): Ent { const e: Ent = { id: this.nextId++, kind, body, g, hp, hpMax: hp, t: 0 }; body.setUserData({ kind, ent: e }); this.ents.push(e); this.L.world.addChild(g); return e; }
  pending: Ent[] = [];
  /** bodies can't be destroyed while the world is stepping (contact callbacks) — queue and flush after the step */
  removeEnt(e: Ent) { e.dead = true; if (this.world.isLocked()) { if (!this.pending.includes(e)) this.pending.push(e); return; } try { this.world.destroyBody(e.body); } catch {} e.g.destroy({ children: true }); this.ents = this.ents.filter((x) => x !== e); }
  flushRemovals() { const q = this.pending; this.pending = []; for (const e of q) { try { this.world.destroyBody(e.body); } catch {} if (!e.g.destroyed) e.g.destroy({ children: true }); this.ents = this.ents.filter((x) => x !== e); } }

  spawnBoulder(vx: number, vy: number) {
    const b = this.world.createBody({ type: "dynamic", position: new pl.Vec2(CATAPULT.x + 0.9, CATAPULT.y + 1.2), bullet: true, angularVelocity: -6 });
    b.createFixture(new pl.Circle(0.8), { density: 4, friction: 0.7, restitution: 0.25 }); b.setLinearVelocity(new pl.Vec2(vx, vy));
    const g = new PIXI.Graphics(); const r = 0.8 * PX; g.circle(0, 0, r).fill(0x6b6470); g.circle(-r * 0.3, -r * 0.3, r * 0.55).fill(0x827a86); g.circle(r * 0.3, r * 0.25, r * 0.22).fill(0x4f4854); g.circle(-r * 0.15, r * 0.4, r * 0.16).fill(0x4f4854); g.circle(0, 0, r).stroke({ width: 2, color: 0x2a2530 });
    const e = this.mkEnt("boulder", b, g, 1); this.burst(CATAPULT.x + 0.9, CATAPULT.y + 1.2, "smoke", 5, 1.5, 0.6, 0xaaa090, 0.5); this.cb.onSfx?.("launch");
    return e;
  }
  spawnCrawler(size = 1) {
    const r = 0.7 * size; const x = WORLD_W + 1 + Math.random() * 2, y = PLAIN_Y + r + 0.05;
    const b = this.world.createBody({ type: "dynamic", position: new pl.Vec2(x, y), fixedRotation: true, linearDamping: 0.4 });
    b.createFixture(new pl.Circle(r), { density: 1.2 * size, friction: 0.1, restitution: 0.05 });
    const g = new PIXI.Container(); const body = new PIXI.Graphics(); g.addChild(body);
    const e = this.mkEnt("crawler", b, g, 30 * size * size); e.size = size; e.ph = Math.random() * 6; e.row = Math.random(); this.hordeLeft++;
    this.drawCrawler(e, 0);
    return e;
  }
  drawCrawler(e: Ent, t: number) {
    const g = e.g.children[0] as PIXI.Graphics; const s = (e.size || 1) * PX; g.clear();
    const legs = 4; const dark = 0x1d1626, pur = 0x4b2a6b;
    for (let side = -1; side <= 1; side += 2) for (let i = 0; i < legs; i++) {
      const ph = t * 12 + (e.ph || 0) + i * 1.3 + (side > 0 ? Math.PI : 0); const sw = (e.stun || 0) > 0 ? 0 : Math.sin(ph) * 0.12;
      const ax = side * (0.22 + i * 0.09) * s + sw * s, ay = -0.05 * s + i * 0.02 * s; const kx = side * (0.42 + i * 0.05) * s + sw * 1.4 * s, ky = -0.25 * s; const fx = side * (0.52 + i * 0.07) * s + sw * 2.2 * s, fy = 0.3 * s + Math.max(0, Math.sin(ph)) * -0.06 * s;
      g.moveTo(0, 0).lineTo(ax, ay).lineTo(kx, ky).lineTo(fx, fy).stroke({ width: Math.max(1.5, s * 0.06), color: dark, cap: "round", join: "round" });
    }
    g.ellipse(0.12 * s, -0.02 * s, 0.34 * s, 0.26 * s).fill(pur); g.ellipse(0.16 * s, -0.08 * s, 0.14 * s, 0.09 * s).fill(0x6d3fa0);   // abdomen + sheen
    g.ellipse(-0.24 * s, 0.02 * s, 0.18 * s, 0.15 * s).fill(dark);                                                             // head
    g.circle(-0.32 * s, -0.03 * s, 0.035 * s).fill(0xff3b3b); g.circle(-0.27 * s, -0.06 * s, 0.03 * s).fill(0xff6a6a);          // eyes
    g.moveTo(-0.38 * s, 0.05 * s).lineTo(-0.44 * s, 0.14 * s).moveTo(-0.3 * s, 0.09 * s).lineTo(-0.34 * s, 0.17 * s).stroke({ width: Math.max(1, s * 0.04), color: 0xe8dcc8 });   // fangs
  }
  spawnTower(blocksH = 6, blocksW = 3) {
    const bw = 1.35, bh = 1.15; const x0 = WORLD_W + 2; const baseW = blocksW * bw + 0.5;
    const base = this.world.createBody({ type: "kinematic", position: new pl.Vec2(x0, PLAIN_Y + 0.3) }); base.createFixture(new pl.Box(baseW / 2, 0.3), { friction: 1.0 }); base.setLinearVelocity(new pl.Vec2(-0.55, 0));
    const bg = new PIXI.Graphics(); bg.roundRect(-baseW / 2 * PX, -0.3 * PX, baseW * PX, 0.6 * PX, 4).fill(0x3a2f4a).stroke({ width: 2, color: 0x6d5a8a }); for (let i = 0; i < 3; i++) bg.circle((-baseW / 2 + 0.4 + i * (baseW - 0.8) / 2) * PX, 0.32 * PX, 0.22 * PX).fill(0x221a2c).stroke({ width: 2, color: 0x6d5a8a });
    const baseE = this.mkEnt("towerBase", base, bg, 999);
    const tower: Tower = { base: baseE, blocks: [], arrived: false, alive: true }; baseE.tower = tower;
    for (let j = 0; j < blocksH; j++) for (let i = 0; i < blocksW; i++) {
      const top = j === blocksH - 1; const bx = x0 + (i - (blocksW - 1) / 2) * bw, by = PLAIN_Y + 0.6 + bh / 2 + j * bh + 0.01;
      const b = this.world.createBody({ type: "dynamic", position: new pl.Vec2(bx, by) }); b.createFixture(new pl.Box(bw / 2 - 0.01, bh / 2 - 0.01), { density: 0.7, friction: 0.85, restitution: 0.02 });
      const g = new PIXI.Graphics(); const c = top ? 0x7c5cb0 : j % 2 ? 0x4c3a6a : 0x574478; g.roundRect(-bw / 2 * PX, -bh / 2 * PX, bw * PX, bh * PX, 3).fill(c).stroke({ width: 1.5, color: 0x8f78b8, alpha: 0.7 });
      g.moveTo(-bw / 2 * PX + 4, -bh / 2 * PX + 4).lineTo(bw / 2 * PX - 4, bh / 2 * PX - 4).stroke({ width: 1, color: 0xc4b5fd, alpha: 0.25 });
      const e = this.mkEnt("block", b, g, top ? 40 : 55); e.tower = tower; tower.blocks.push(e);
    }
    this.towers.push(tower); this.hordeLeft += 1;
  }
  spawnRam() {
    const x0 = WORLD_W + 3, w = 4.0, h = 1.7, y = PLAIN_Y + 0.7 + h / 2;
    const body = this.world.createBody({ type: "dynamic", position: new pl.Vec2(x0, y) }); body.createFixture(new pl.Box(w / 2, h / 2), { density: 2.5, friction: 0.4 });
    const g = new PIXI.Graphics(); g.roundRect(-w / 2 * PX, -h / 2 * PX, w * PX, h * PX, 6).fill(0x3d2a1e).stroke({ width: 2, color: 0x8a6a3a });
    g.ellipse(0, -h * 0.55 * PX, w * 0.52 * PX, h * 0.45 * PX).fill(0x2a1f18).stroke({ width: 2, color: 0x6a4e2e });   // beetle shell
    g.moveTo(-w / 2 * PX, -h * 0.1 * PX).lineTo(-w / 2 * PX - 0.7 * PX, -h * 0.35 * PX).stroke({ width: 5, color: 0x2a1f18 }); g.moveTo(-w / 2 * PX, h * 0.1 * PX).lineTo(-w / 2 * PX - 0.7 * PX, h * 0.35 * PX).stroke({ width: 5, color: 0x2a1f18 });   // horns
    g.circle(-w * 0.42 * PX, -h * 0.35 * PX, 3).fill(0xff3b3b);
    const bodyE = this.mkEnt("ram", body, g, 320);
    const ram: Ram = { body: bodyE, wheels: [], joints: [], arrived: false, alive: true }; bodyE.ram = ram;
    for (const dx of [-1.35, 1.35]) {
      const wb = this.world.createBody({ type: "dynamic", position: new pl.Vec2(x0 + dx, PLAIN_Y + 0.68) }); wb.createFixture(new pl.Circle(0.68), { density: 1.5, friction: 1.2 });
      const wg = new PIXI.Graphics(); wg.circle(0, 0, 0.68 * PX).fill(0x2b2118).stroke({ width: 3, color: 0x8a6a3a }); for (let k = 0; k < 4; k++) wg.moveTo(0, 0).lineTo(Math.cos(k * Math.PI / 2) * 0.6 * PX, Math.sin(k * Math.PI / 2) * 0.6 * PX).stroke({ width: 2, color: 0x8a6a3a });
      const we = this.mkEnt("wheel", wb, wg, 999); ram.wheels.push(we);
      const j = this.world.createJoint(new pl.RevoluteJoint({ enableMotor: true, maxMotorTorque: 60, motorSpeed: 2.6 }, body, wb, wb.getPosition())) as pl.RevoluteJoint; if (j) ram.joints.push(j);
    }
    this.rams.push(ram); this.hordeLeft += 1;
  }
  killRam(r: Ram) { r.alive = false; this.hordeLeft--; this.removeEnt(r.body); for (const w of r.wheels) { w.body.setUserData({ kind: "wheel" }); w.body.setAngularVelocity((Math.random() - 0.5) * 20); w.body.applyLinearImpulse(new pl.Vec2((Math.random() - 0.5) * 8, 6 + Math.random() * 4), w.body.getWorldCenter(), true); setTimeout(() => { if (!this.over) this.removeEnt(w); }, 2500); } }

  // ── scenery (placeholder art for phase 1: real painted layers come in phase 2)
  buildScenery() {
    const sky = new PIXI.Graphics(); const H = WORLD_H * PX, W = WORLD_W * PX;
    sky.rect(0, 0, W * 1.2, H * 1.2).fill({ color: 0x0c1224 }); for (let i = 0; i < 18; i++) { const y = (i / 18) * H * 1.2; sky.rect(0, y, W * 1.2, H * 1.2 / 18 + 2).fill({ color: this.lerpColor(0x0a0f1f, 0x3a2438, i / 18) }); }
    for (let i = 0; i < 90; i++) { sky.circle(Math.random() * W * 1.2, Math.random() * H * 0.55, Math.random() * 1.6 + 0.3).fill({ color: 0xffffff, alpha: 0.35 + Math.random() * 0.5 }); }
    this.L.sky.addChild(sky);
    const moon = new PIXI.Sprite(this.tex.glow); moon.anchor.set(0.5); moon.tint = 0xf4e8c8; moon.width = moon.height = 5.5 * PX; moon.position.set(41 * PX, 3.6 * PX); moon.alpha = 0.9; this.L.far.addChild(moon);
    const moonCore = new PIXI.Graphics(); moonCore.circle(41 * PX, 3.6 * PX, 1.05 * PX).fill(0xefe3c2); this.L.far.addChild(moonCore);
    // far hills
    const hills = new PIXI.Graphics(); hills.moveTo(0, this.sy(6)); for (let x = 0; x <= WORLD_W + 4; x += 1) hills.lineTo(this.sx(x), this.sy(4.2 + Math.sin(x * 0.35) * 0.9 + Math.sin(x * 0.11 + 2) * 1.4)); hills.lineTo(this.sx(WORLD_W + 4), this.sy(-2)).lineTo(0, this.sy(-2)).closePath().fill(0x161a2a); this.L.far.addChild(hills);
    // ground
    const gnd = new PIXI.Graphics(); gnd.moveTo(this.sx(GROUND[0][0]), this.sy(GROUND[0][1])); for (const [x, y] of GROUND) gnd.lineTo(this.sx(x), this.sy(y)); gnd.lineTo(this.sx(WORLD_W + 4), this.sy(-3)).lineTo(0, this.sy(-3)).closePath().fill(0x1c1720);
    gnd.moveTo(this.sx(12.8), this.sy(PLAIN_Y)).lineTo(this.sx(WORLD_W + 4), this.sy(PLAIN_Y)).stroke({ width: 3, color: 0x2e2836 });
    for (let i = 0; i < 60; i++) { const x = 13.5 + Math.random() * (WORLD_W - 12); gnd.ellipse(this.sx(x), this.sy(PLAIN_Y - 0.1 - Math.random() * 1.2), 6 + Math.random() * 14, 2 + Math.random() * 3).fill({ color: 0x2a2330, alpha: 0.6 }); }
    // hill face + citadel
    gnd.moveTo(this.sx(0), this.sy(12)).lineTo(this.sx(7.2), this.sy(12)).lineTo(this.sx(12.2), this.sy(7.6)).lineTo(this.sx(12.8), this.sy(7.6)).lineTo(this.sx(12.8), this.sy(PLAIN_Y)).lineTo(this.sx(0), this.sy(PLAIN_Y)).closePath().fill(0x2a2019);
    for (let i = 0; i < 40; i++) { const x = Math.random() * 12, y = 2.6 + Math.random() * (11.5 - (x / 12) * 4.5); gnd.ellipse(this.sx(x), this.sy(y), 6 + Math.random() * 10, 3 + Math.random() * 4).fill({ color: 0x3a2c22, alpha: 0.7 }); }
    this.L.world.addChild(gnd);
    const stone = 0x2d3548, edge = 0x4a5670, dark = 0x1f2536;
    const cit = new PIXI.Graphics();
    // outer wall + gate tower
    cit.rect(this.sx(11.2), this.sy(8.6), 1.7 * PX, 6.4 * PX).fill(stone).stroke({ width: 2, color: edge }); for (let i = 0; i < 3; i++) cit.rect(this.sx(11.2 + i * 0.6), this.sy(9.1), 0.4 * PX, 0.5 * PX).fill(stone);
    cit.moveTo(this.sx(12.85), this.sy(2.2)).lineTo(this.sx(12.85), this.sy(5.4)).arc(this.sx(12.85), this.sy(5.4), 0.9 * PX, Math.PI, 1.5 * Math.PI).stroke({ width: 0 });
    cit.roundRect(this.sx(12.15), this.sy(6.2), 0.75 * PX, 4 * PX, 6).fill(0x120d0b);   // gate door
    for (let i = 0; i < 6; i++) cit.rect(this.sx(12.15), this.sy(6.0 - i * 0.65), 0.75 * PX, 2).fill(0x3a2a1a);
    // upper citadel wall on the hilltop
    cit.rect(this.sx(2.2), this.sy(15.6), 6.2 * PX, 3.7 * PX).fill(stone).stroke({ width: 2, color: edge });
    for (let i = 0; i < 8; i++) cit.rect(this.sx(2.2 + i * 0.8), this.sy(16.1), 0.5 * PX, 0.5 * PX).fill(stone);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) cit.rect(this.sx(2.3 + c * 0.77 + (r % 2) * 0.38), this.sy(15.4 - r * 0.7), 0.6 * PX, 0.5 * PX).stroke({ width: 1, color: dark, alpha: 0.7 });
    cit.rect(this.sx(0.6), this.sy(18.2), 1.7 * PX, 6.3 * PX).fill(0x33405a).stroke({ width: 2, color: edge }); cit.rect(this.sx(8.6), this.sy(17.4), 1.7 * PX, 5.5 * PX).fill(0x33405a).stroke({ width: 2, color: edge });
    cit.moveTo(this.sx(0.6), this.sy(18.2)).lineTo(this.sx(1.45), this.sy(19.6)).lineTo(this.sx(2.3), this.sy(18.2)).closePath().fill(0x7c3aed); cit.moveTo(this.sx(8.6), this.sy(17.4)).lineTo(this.sx(9.45), this.sy(18.8)).lineTo(this.sx(10.3), this.sy(17.4)).closePath().fill(0xe0475b);
    this.L.world.addChild(cit);
    // torches
    for (const [x, y] of [[1.45, 17.9], [9.45, 17.1], [11.6, 8.9], [3.5, 15.9], [7.4, 15.9]]) { const t = new PIXI.Sprite(this.tex.glow); t.anchor.set(0.5); t.tint = 0xffa63a; t.width = t.height = 2.2 * PX; t.position.set(this.sx(x), this.sy(y)); t.alpha = 0.7; t.blendMode = "add"; this.L.fx.addChild(t); this.torches.push(t); const f = new PIXI.Graphics(); f.circle(this.sx(x), this.sy(y), 3).fill(0xffe0a0); this.L.world.addChild(f); }
  }
  lerpColor(a: number, b: number, t: number) { const ar = a >> 16, ag = (a >> 8) & 255, ab = a & 255, br = b >> 16, bg = (b >> 8) & 255, bb = b & 255; return ((ar + (br - ar) * t) << 16) | ((ag + (bg - ag) * t) << 8) | (ab + (bb - ab) * t); }
  buildCatapult() {
    const c = new PIXI.Container(); c.position.set(this.sx(CATAPULT.x), this.sy(CATAPULT.y));
    const base = new PIXI.Graphics(); base.roundRect(-1.1 * PX, -0.35 * PX, 2.2 * PX, 0.5 * PX, 4).fill(0x5a4630).stroke({ width: 2, color: 0x8a6a3a }); base.circle(-0.7 * PX, 0.05 * PX, 0.28 * PX).fill(0x3a2c1e).stroke({ width: 2, color: 0x8a6a3a }); base.circle(0.7 * PX, 0.05 * PX, 0.28 * PX).fill(0x3a2c1e).stroke({ width: 2, color: 0x8a6a3a });
    base.moveTo(-0.5 * PX, -0.3 * PX).lineTo(0.1 * PX, -1.3 * PX).lineTo(0.7 * PX, -0.3 * PX).stroke({ width: 5, color: 0x6a5238 });
    this.armG = new PIXI.Graphics(); this.drawArm(0.3); this.armG.position.set(0.1 * PX, -1.2 * PX);
    c.addChild(base, this.armG); this.L.world.addChild(c); this.catapultG = c;
    this.previewG = new PIXI.Graphics(); this.L.front.addChild(this.previewG);
  }
  drawArm(pull: number) { const g = this.armG; g.clear(); const ang = -0.9 + pull * 1.3; const len = 2.4 * PX; const ex = Math.cos(ang) * len, ey = Math.sin(ang) * len; g.moveTo(0, 0).lineTo(ex, ey).stroke({ width: 7, color: 0x8a6a3a, cap: "round" }); g.circle(ex, ey, 0.32 * PX).fill(0x3a2f36).stroke({ width: 2, color: 0x6a5a66 }); if (this.reload <= 0 && this.state !== "lost") g.circle(ex, ey, 0.26 * PX).fill(0x6b6470); }

  // ── input (slingshot: press anywhere, drag back, release)
  bindInput() {
    const cv = this.canvas; const pos = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener("pointerdown", (e) => { if (this.state === "ready") this.start(); if (this.state !== "play" || this.reload > 0) return; this.aiming = true; this.aimStart = pos(e); this.aimNow = this.aimStart; cv.setPointerCapture(e.pointerId); e.preventDefault(); });
    cv.addEventListener("pointermove", (e) => { if (!this.aiming) return; this.aimNow = pos(e); });
    const release = (e: PointerEvent) => { if (!this.aiming) return; this.aiming = false; const v = this.aimVelocity(); this.previewG.clear(); if (!v) return; this.spawnBoulder(v.x, v.y); this.reload = this.reloadTime; this.armG.rotation = 0; this.drawArm(0); void e; };
    cv.addEventListener("pointerup", release); cv.addEventListener("pointercancel", release);
    cv.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  }
  aimVelocity() { const dx = (this.aimStart.x - this.aimNow.x) / this.scale, dy = (this.aimNow.y - this.aimStart.y) / this.scale; const len = Math.hypot(dx, dy); if (len < 14) return null; const k = Math.min(1, len / 170); const speed = 10 + k * 22; const a = Math.atan2(dy, dx); return { x: Math.cos(a) * speed, y: Math.sin(a) * speed, k }; }

  // ── game flow
  start() { if (this.state !== "ready") return; this.state = "play"; this.gateHp = this.gateMax; this.wave = 0; this.score = 0; this.kills = 0; this.nextWave(); this.pushHud(); }
  nextWave() {
    if (this.wave >= WAVES.length) { this.end(true); return; }
    const w = WAVES[this.wave]; this.wave++; this.waveDone = false; this.say(this.wave === WAVES.length ? "FINAL WAVE — hold the gate!" : `WAVE ${this.wave}`, 2.2); if (this.wave === 4) this.cb.onSfx?.("horn");
    let t = 1.2; this.spawnQueue = [];
    for (let i = 0; i < w.crawlers; i++) { this.spawnQueue.push({ at: t, fn: () => this.spawnCrawler(0.85 + Math.random() * 0.4) }); t += w.gap * (0.6 + Math.random() * 0.8); }
    for (let i = 0; i < w.big; i++) { this.spawnQueue.push({ at: 2 + Math.random() * t, fn: () => this.spawnCrawler(1.6 + Math.random() * 0.4) }); }
    for (let i = 0; i < (w.tower || 0); i++) this.spawnQueue.push({ at: 1.5 + i * 9, fn: () => this.spawnTower(4 + i, 3) });
    for (let i = 0; i < (w.ram || 0); i++) this.spawnQueue.push({ at: 4 + i * 12, fn: () => this.spawnRam() });
    this.spawnQueue.sort((a, b) => a.at - b.at); this.waveT = 0;
  }
  end(won: boolean) { if (this.state !== "play") return; this.state = won ? "won" : "lost"; this.say(won ? "THE HORN SOUNDS — the gate held 👑" : "THE GATE HAS FALLEN", 4); this.cb.onSfx?.(won ? "win" : "lose"); if (!won) { this.shake = 2; this.burst(GATE.x1, 4.5, "smoke", 30, 3, 2.2, 0x6a5a5a, 1.4); this.burst(GATE.x1, 4, "dirt", 30, 5, 1.2, 0xb8a48a, 0.4); } this.pushHud(); setTimeout(() => this.cb.onEnd?.({ won, score: this.score, kills: this.kills, waves: this.wave }), 1500); }
  say(m: string, t = 1.6) { this.msg = m; this.msgT = t; this.pushHud(); }
  pushHud() { this.cb.onHud({ gate: Math.ceil(this.gateHp), gateMax: this.gateMax, wave: this.wave, waves: WAVES.length, horde: Math.max(0, this.hordeLeft), score: this.score, kills: this.kills, reload: this.reloadTime > 0 ? Math.max(0, this.reload / this.reloadTime) : 0, state: this.state, msg: this.msg }); }

  // ── VFX
  burst(x: number, y: number, tex: string, n: number, speed: number, life: number, tint: number, size: number, opts: Partial<Part> = {}) {
    for (let i = 0; i < n; i++) { const s = new PIXI.Sprite(this.tex[tex]); s.anchor.set(0.5); s.blendMode = "add"; s.tint = tint; const sz = size * PX * (0.6 + Math.random() * 0.8); s.width = s.height = sz; s.position.set(this.sx(x), this.sy(y)); s.rotation = Math.random() * 6.28; const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random()) * PX; this.L.fx.addChild(s); const lf = life * (0.6 + Math.random() * 0.6); this.parts.push({ s, vx: Math.cos(a) * v, vy: -Math.abs(Math.sin(a)) * v - v * 0.3, life: lf, life0: lf, grow: 1 + Math.random() * 0.8, spin: (Math.random() - 0.5) * 4, g: 14 * PX, fade: 1, size: sz, ...opts }); }
  }
  hitFx(x: number, y: number, k: number) {
    this.burst(x, y, "spark", 3 + Math.round(k * 4), 0.5, 0.25, 0xffd27a, 1.6 + k * 1.6, { g: 0, grow: 2.5 }); this.burst(x, y, "flare", 1, 0, 0.18, 0xfff2c0, 3 + k * 3, { g: 0, grow: 3 });
    this.burst(x, y, "dirt", 6 + Math.round(k * 8), 2 + k * 3, 0.9, 0x9c8a6a, 0.35, { spin: 3 }); this.burst(x, y, "smoke", 4, 1.2, 1.1, 0x6f6a80, 0.9);
    const r = new PIXI.Sprite(this.tex.ring); r.anchor.set(0.5); r.blendMode = "add"; r.tint = 0xffc36a; r.width = r.height = 0.6 * PX; r.position.set(this.sx(x), this.sy(y)); this.L.fx.addChild(r); this.parts.push({ s: r, vx: 0, vy: 0, life: 0.45, life0: 0.45, grow: 7 + k * 5, spin: 0, g: 0, fade: 1, size: 0.6 * PX });
    this.shock.center = { x: this.ox + this.sx(x) * this.scale, y: this.oy + this.sy(y) * this.scale }; this.shock.time = 0; this.shockT = 0; this.shake = Math.max(this.shake, 0.3 + k * 0.6); this.cb.onSfx?.(k > 0.6 ? "crash" : "impact");
  }

  // ── loop
  frame() {
    if (this.over) return; const now = performance.now(); const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.t += dt;
    if (this.state === "play") { this.acc += dt; let n = 0; while (this.acc >= 1 / 120 && n++ < 6) { this.step(1 / 120); this.acc -= 1 / 120; } if (n >= 6) this.acc = 0; }
    this.render(dt);
  }
  step(dt: number) {
    this.waveT += dt; if (this.reload > 0) this.reload -= dt; if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) { this.msg = null; this.pushHud(); } }
    while (this.spawnQueue.length && this.spawnQueue[0].at <= this.waveT) this.spawnQueue.shift()!.fn();
    // crawlers march
    for (const e of this.ents) {
      if (e.dead) continue; e.t += dt;
      if (e.kind === "crawler") { if ((e.stun || 0) > 0) e.stun! -= dt; else { const v = e.body.getLinearVelocity(); const p = e.body.getPosition(); const target = -(1.7 + (e.row || 0) * 0.9) / Math.sqrt(e.size || 1); if (p.x > GATE.x1 + (e.size || 1) * 0.75) { e.body.setLinearVelocity(new pl.Vec2(v.x + (target - v.x) * 0.15, v.y)); } else { e.body.setLinearVelocity(new pl.Vec2(0, v.y)); } if (p.y < PLAIN_Y - 3 || p.x < 11) { this.hordeLeft--; this.removeEnt(e); } } }
      else if (e.kind === "boulder") { const v = e.body.getLinearVelocity(); const p = e.body.getPosition(); if (e.t > 7 || p.x > WORLD_W + 8 || p.x < 0 || p.y < -2 || (e.t > 1 && Math.hypot(v.x, v.y) < 0.35)) { if (p.y > 0) this.burst(p.x, p.y, "smoke", 4, 1, 0.8, 0x8a8090, 0.6); this.removeEnt(e); } }
      else if (e.kind === "block") { const p = e.body.getPosition(); if (p.y < -2) this.removeEnt(e); }
    }
    // towers: stop at the wall and grind the gate; a tower with no blocks left is gone
    for (const tw of this.towers) { if (!tw.alive) continue; const bp = tw.base.body.getPosition(); if (!tw.arrived && bp.x < GATE.x1 + 1.6) { tw.arrived = true; tw.base.body.setLinearVelocity(new pl.Vec2(0, 0)); this.say("A siege tower reached the wall!", 1.8); }
      tw.blocks = tw.blocks.filter((b) => !b.dead); const standing = tw.blocks.filter((b) => b.body.getPosition().y > PLAIN_Y + 1.6).length;
      if (tw.arrived && standing >= 3) this.hurtGate(dt * 14);
      if (standing < 2) { tw.alive = false; this.hordeLeft--; this.score += 120; this.say("Siege tower toppled! +120", 1.4); const p = tw.base.body.getPosition(); this.burst(p.x, p.y + 1, "dirt", 14, 3, 1, 0xcbbde8, 0.35); this.removeEnt(tw.base); }
    }
    for (const r of this.rams) { if (!r.alive) continue; const p = r.body.body.getPosition(); if (!r.arrived && p.x < GATE.x1 + 1.6) { r.arrived = true; this.say("Beetle ram at the gate!", 1.8); } if (r.arrived) { for (const j of r.joints) j.setMotorSpeed(0); r.body.body.setLinearVelocity(new pl.Vec2(0, 0)); this.hurtGate(dt * 26); if (Math.floor(this.t * 1.5) !== Math.floor((this.t - dt) * 1.5)) { this.shake = 0.5; this.burst(GATE.x1, p.y + 0.3, "dirt", 6, 2.5, 0.7, 0xb8a48a, 0.25); this.cb.onSfx?.("gate"); } } if (p.x < 10) { r.alive = false; this.hordeLeft--; } }
    this.world.step(dt, 8, 3); this.flushRemovals();
    // wave end
    if (!this.waveDone && !this.spawnQueue.length && this.hordeLeft <= 0) { this.waveDone = true; this.score += 50 * this.wave; setTimeout(() => { if (this.state === "play") this.nextWave(); }, 1800); }
    this.hudT += dt; if (this.hudT > 0.15) { this.hudT = 0; this.pushHud(); }
  }
  render(dt: number) {
    for (const e of this.ents) { if (e.dead) continue; const p = e.body.getPosition(); e.g.position.set(this.sx(p.x), this.sy(p.y)); e.g.rotation = -e.body.getAngle(); if (e.kind === "crawler") { e.g.scale.x = 1; this.drawCrawler(e, this.t); e.g.zIndex = (e.row || 0) * 10; } }
    // torches flicker
    for (const [i, t] of this.torches.entries()) t.alpha = 0.55 + Math.sin(this.t * 9 + i * 1.7) * 0.12 + Math.random() * 0.06;
    // particles
    for (const p of this.parts) { p.life -= dt; p.s.x += p.vx * dt; p.s.y += p.vy * dt; p.vy += p.g * dt; const k = Math.max(0, p.life / p.life0); p.s.alpha = Math.min(1, k * 1.5) * p.fade; const sz = p.size * (1 + (1 - k) * (p.grow - 1)); p.s.width = p.s.height = Math.max(1, sz); p.s.rotation += p.spin * dt; }
    for (const p of this.parts) if (p.life <= 0) p.s.destroy(); this.parts = this.parts.filter((p) => p.life > 0);
    // shockwave + shake
    if (this.shockT < 1.2) { this.shockT += dt; this.shock.time = this.shockT; } else this.shock.time = 99;
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 2.5); const sx = (Math.random() - 0.5) * this.shake * 6, sy = (Math.random() - 0.5) * this.shake * 4; for (const k of ["world", "fx", "front"] as const) this.L[k].position.set(this.ox + sx, this.oy + sy); }
    // aim preview + arm
    this.previewG.clear();
    if (this.aiming) { const v = this.aimVelocity(); if (v) { this.drawArm(v.k); let x = CATAPULT.x + 0.9, y = CATAPULT.y + 1.2, vx = v.x, vy = v.y; for (let i = 0; i < 46; i++) { const h = 0.05; x += vx * h; y += vy * h; vy -= G * h; if (y < this.groundAt(x)) break; if (i % 2 === 0) this.previewG.circle(this.sx(x), this.sy(y), 3 - i * 0.04).fill({ color: 0xffd27a, alpha: 0.85 - i * 0.015 }); } } }
    else if (this.reload > 0) this.drawArm(0.9 * (1 - this.reload / this.reloadTime));
  }
  groundAt(x: number) { for (let i = 1; i < GROUND.length; i++) { const [x0, y0] = GROUND[i - 1], [x1, y1] = GROUND[i]; if (x >= x0 && x <= x1) { if (x1 === x0) return Math.min(y0, y1); return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); } } return PLAIN_Y; }
}
