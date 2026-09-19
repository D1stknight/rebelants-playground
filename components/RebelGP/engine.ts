// components/RebelGP/engine.ts
// Rebel Grand Prix — SNES-style Mode 7 kart racer on a 2D canvas. Everything is a sprite; the ground is one painted
// 1024×1024 map per track sampled per scanline. No WebGL, no framework in the hot loop.
import { CHASSIS, GP_LAPS, GP_RACERS, ITEM_TABLE, type ChassisId, type ItemId } from "../../lib/rgpConfig";

export const VW = 480, VW_MAX = 800, VH = 270, HORIZON = 96;
const MAP = 1024, MMASK = MAP - 1, FOCAL = 230, CAM_H = 20, CAM_BACK = 60;
const SURF = { grass: 0, road: 1, shoulder: 2, boost: 3, wall: 4, liquid: 5, sand: 6, slick: 7 };
export const PROP = { tree: 0, rock: 1, mushroom: 2, pipe: 3, barrel: 4, torch: 5, pillar: 6, crystal: 7, egg: 8, flower: 9, fence: 10, itembox: 11, slick: 12, shell: 13, spider: 14, boulder: 15, crusher: 16, geyser: 17, wasp: 18, wrath: 19, spore: 20, shield: 21, star: 22, puff: 23, tree2: 24, rock2: 25, lawnmower: 26, crystal2: 27 } as const;

export type TrackData = {
  id: string; name: string; biome: string; laps: number; width: number; length: number; diff: number;
  center: [number, number][]; heading: number; grid: [number, number][]; boosts: [number, number][]; boxes: [number, number][];
  hazards: any[]; decor: [number, number, string][];
};
export type Input = { left: boolean; right: boolean; accel: boolean; brake: boolean; drift: boolean; item: boolean };
export type Kart = {
  id: number; faction: string; chassis: ChassisId; ai: boolean; name: string;
  x: number; y: number; h: number; speed: number; steer: number;
  drift: 0 | -1 | 1; driftT: number; boost: number; spin: number; blind: number; shield: number; invuln: number;
  item: ItemId | null; roulette: number; itemCd: number;
  cp: number; lap: number; prog: number; rank: number; finished: boolean; finishT: number;
  respawn: number; lane: number; aiSkill: number; aiNoise: number; hop: number; wobble: number;
  prevInputItem: boolean;
};
type Proj = { kind: "shell" | "wasp" | "wrath"; x: number; y: number; h: number; speed: number; life: number; owner: number; target: number; bounces: number };
type Drop = { kind: "slick"; x: number; y: number; life: number };
type Fx = { kind: "star" | "puff"; x: number; y: number; life: number; z?: number };
export type Hud = { lap: number; laps: number; rank: number; item: ItemId | null; roulette: boolean; speed: number; t: number; state: RaceState; countdown: number; blind: number; boostLeft: number; standings: { name: string; faction: string; rank: number; finished: boolean; you: boolean }[]; minimap: { x: number; y: number; you: boolean }[]; msg: string | null };
export type RaceState = "intro" | "countdown" | "race" | "finished";
export type Callbacks = { onHud: (h: Hud) => void; onSfx: (n: string) => void; onEnd: (r: { place: number; time: number; laps: number }) => void };

const sheets: Record<string, HTMLImageElement> = {};
function img(src: string) { if (sheets[src]) return sheets[src]; const i = new Image(); i.src = src; sheets[src] = i; return i; }
export function preloadTrack(t: string, factions: string[], chassis: ChassisId[]) {
  img(`/rgp/tracks/${t}/map.png`); img(`/rgp/tracks/${t}/surf.png`); img("/rgp/props.png"); factions.forEach((f, i) => img(`/rgp/karts/kart_${f}_${chassis[i] || "soldier"}.png`));
}
export async function loadTrack(id: string): Promise<{ data: TrackData; map: Uint32Array; surf: Uint8Array }> {
  const data: TrackData = await (await fetch(`/rgp/tracks/${id}/track.json`, { cache: "force-cache" })).json();
  const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const [mi, si] = await Promise.all([load(`/rgp/tracks/${id}/map.png`), load(`/rgp/tracks/${id}/surf.png`)]);
  const cv = document.createElement("canvas"); cv.width = MAP; cv.height = MAP; const c = cv.getContext("2d", { willReadFrequently: true })!;
  c.drawImage(mi, 0, 0); const map = new Uint32Array(c.getImageData(0, 0, MAP, MAP).data.buffer);
  c.clearRect(0, 0, MAP, MAP); c.drawImage(si, 0, 0); const sd = c.getImageData(0, 0, MAP, MAP).data; const surf = new Uint8Array(MAP * MAP);
  for (let i = 0; i < MAP * MAP; i++) surf[i] = sd[i * 4];
  return { data, map, surf };
}

const AI_NAMES = ["Mandible", "Thorax", "Chitin", "Pheromone", "Antenna", "Grub", "Larva", "Drone", "Forager", "Soldier", "Nectar", "Tunnel"];
const ITEM_KEYS = Object.keys(ITEM_TABLE);

export class Race {
  ctx: CanvasRenderingContext2D; buf: ImageData; buf32: Uint32Array; vw = VW;
  track: TrackData; map: Uint32Array; surf: Uint8Array; cb: Callbacks;
  karts: Kart[] = []; me: Kart; projs: Proj[] = []; drops: Drop[] = []; fx: Fx[] = []; boxes: { x: number; y: number; t: number }[];
  hazards: any[]; t = 0; state: RaceState = "intro"; stateT = 0; countdown = 3; over = false; raf = 0; last = 0; acc = 0;
  input: Input = { left: false, right: false, accel: false, brake: false, drift: false, item: false };
  camX = 0; camY = 0; camH = 0; hudT = 0; msg: string | null = null; msgT = 0; shake = 0;
  props: HTMLImageElement; sky: HTMLImageElement; skyMid: HTMLImageElement; kartImg: Record<string, HTMLImageElement> = {};
  N: number; cpStep: number; finishedCount = 0; errCount = 0; autopilot = false;

  constructor(canvas: HTMLCanvasElement, loaded: { data: TrackData; map: Uint32Array; surf: Uint8Array }, cb: Callbacks, faction: string, chassis: ChassisId, rivals?: { faction: string; chassis: ChassisId }[]) {
    this.ctx = canvas.getContext("2d")!; this.ctx.imageSmoothingEnabled = false;
    this.buf = this.ctx.createImageData(this.vw, VH); this.buf32 = new Uint32Array(this.buf.data.buffer);
    this.track = loaded.data; this.map = loaded.map; this.surf = loaded.surf; this.cb = cb;
    this.N = this.track.center.length; this.cpStep = this.track.length / this.N;
    this.props = img("/rgp/props.png"); const sb = this.track.biome === "garden" ? "jungle" : this.track.biome; this.sky = img(`/bounty/bg_${sb}_far.png`); this.skyMid = img(`/bounty/bg_${sb}_mid.png`);
    this.boxes = this.track.boxes.map(([x, y]) => ({ x, y, t: 0 }));
    this.hazards = this.track.hazards.map((h) => ({ ...h, x: h.x ?? h.a[0], y: h.y ?? h.a[1], phase: h.phase || 0 }));
    // racers: player + 7 rivals from the other factions
    const allF = ["ashigaru", "ronin", "samurai", "bushi", "warrior", "shogun", "buke", "kenshi", "wokou", "sohei", "yamabushi"].filter((f) => f !== faction);
    const seed = this.track.diff * 31 + 7; const rng = mulberry(seed); allF.sort(() => rng() - 0.5);
    const chas: ChassisId[] = ["scout", "soldier", "tank"];
    const list = [{ faction, chassis, ai: false }, ...Array.from({ length: GP_RACERS - 1 }, (_, i) => rivals?.[i] ? { ...rivals[i], ai: true } : { faction: allF[i], chassis: chas[Math.floor(rng() * 3)], ai: true })];
    // player starts last on the grid (Mario Kart style for race 1); rivals ahead
    const order = [...list.slice(1), list[0]];
    order.forEach((r, i) => {
      const [gx, gy] = this.track.grid[i]; const k = this.mk(i, r.faction, r.chassis, r.ai, gx, gy);
      k.aiSkill = 0.75 + (this.track.diff / 15) * 0.25 + rng() * 0.08; k.lane = (rng() - 0.5) * 0.9; k.aiNoise = rng() * 10;
      k.name = r.ai ? AI_NAMES[(i * 5 + this.track.diff) % AI_NAMES.length] : "YOU";
      this.kartImg[k.faction + k.chassis] = img(`/rgp/karts/kart_${k.faction}_${k.chassis}.png`);
      this.karts.push(k);
    });
    this.me = this.karts.find((k) => !k.ai)!;
    this.camX = this.me.x - Math.cos(this.me.h) * CAM_BACK; this.camY = this.me.y - Math.sin(this.me.h) * CAM_BACK; this.camH = this.me.h;
    this.pushHud();
  }
  /** widen the view for phone landscape (480–800 px); the canvas backing store and scanline buffer follow */
  setView(w: number) {
    const nw = Math.max(VW, Math.min(VW_MAX, Math.round(w))); if (nw === this.vw && this.ctx.canvas.width === nw) return;
    this.vw = nw; this.ctx.canvas.width = nw; this.ctx.canvas.height = VH; this.ctx.imageSmoothingEnabled = false;
    this.buf = this.ctx.createImageData(nw, VH); this.buf32 = new Uint32Array(this.buf.data.buffer);
  }
  mk(id: number, faction: string, chassis: ChassisId, ai: boolean, x: number, y: number): Kart {
    const cp = this.nearestCp(x, y, 0);
    return { id, faction, chassis, ai, name: "", x, y, h: this.track.heading, speed: 0, steer: 0, drift: 0, driftT: 0, boost: 0, spin: 0, blind: 0, shield: 0, invuln: 0, item: null, roulette: 0, itemCd: 0, cp, lap: -1, prog: 0, rank: id + 1, finished: false, finishT: 0, respawn: 0, lane: 0, aiSkill: 1, aiNoise: 0, hop: 0, wobble: 0, prevInputItem: false };
  }

  // ── loop
  start() {
    this.last = performance.now(); this.setState("intro", `${this.track.name.toUpperCase()}`);
    const loop = (now: number) => {
      if (this.over) return;
      const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.acc += dt;
      try { let n = 0; while (this.acc >= 1 / 60 && n++ < 4) { this.step(1 / 60); this.acc -= 1 / 60; } if (n >= 4) this.acc = 0; this.render(); this.errCount = 0; }
      catch (e) { console.error("RGP frame error", e); this.acc = 0; if (++this.errCount > 90) { this.over = true; return; } }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { this.over = true; cancelAnimationFrame(this.raf); }
  setState(s: RaceState, msg: string | null = null) { this.state = s; this.stateT = 0; if (msg) { this.msg = msg; this.msgT = 2.2; } this.pushHud(); }
  sfx(n: string) { this.cb.onSfx(n); }

  // ── track helpers
  surfAt(x: number, y: number) { const xi = x | 0, yi = y | 0; if (xi < 0 || yi < 0 || xi >= MAP || yi >= MAP) return SURF.grass; return this.surf[yi * MAP + xi]; }
  nearestCp(x: number, y: number, from: number, win = 24) {
    let best = from, bd = 1e12; const C = this.track.center;
    for (let d = -win; d <= win; d++) { const i = (from + d + this.N * 4) % this.N; const dx = C[i][0] - x, dy = C[i][1] - y; const dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = i; } }
    return best;
  }
  centerAt(i: number) { return this.track.center[(i + this.N * 4) % this.N]; }

  // ── simulation
  step(dt: number) {
    this.t += dt; this.stateT += dt; if (this.msgT > 0) this.msgT -= dt; else this.msg = null;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 5);
    if (this.state === "intro" && this.stateT > 1.6) { this.setState("countdown"); this.countdown = 3; this.sfx("count"); }
    if (this.state === "countdown") { const c = 3 - Math.floor(this.stateT); if (c !== this.countdown && c > 0) { this.countdown = c; this.sfx("count"); } if (this.stateT >= 3) { this.setState("race", "GO!"); this.countdown = 0; this.sfx("go"); } }
    const racing = this.state === "race" || this.state === "finished";
    for (const k of this.karts) this.stepKart(k, dt, racing);
    this.collideKarts();
    if (racing) { this.stepProjs(dt); this.stepDrops(dt); this.stepHazards(dt); this.stepBoxes(dt); }
    for (const f of this.fx) f.life -= dt; this.fx = this.fx.filter((f) => f.life > 0);
    this.rank();
    // camera follows the player
    const me = this.me; const th = me.h; let dh = th - this.camH; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
    this.camH += dh * Math.min(1, dt * 7);
    const tx = me.x - Math.cos(this.camH) * CAM_BACK, ty = me.y - Math.sin(this.camH) * CAM_BACK;
    this.camX += (tx - this.camX) * Math.min(1, dt * 12); this.camY += (ty - this.camY) * Math.min(1, dt * 12);
    this.hudT += dt; if (this.hudT > 0.1) { this.hudT = 0; this.pushHud(); }
  }

  stepKart(k: Kart, dt: number, racing: boolean) {
    const ch = CHASSIS.find((c) => c.id === k.chassis)!;
    if (k.respawn > 0) { k.respawn -= dt; k.speed = 0; if (k.respawn <= 0) { const c = this.centerAt(k.cp - 3); k.x = c[0]; k.y = c[1]; const n = this.centerAt(k.cp); k.h = Math.atan2(n[1] - c[1], n[0] - c[0]); k.invuln = 1.5; } return; }
    k.invuln = Math.max(0, k.invuln - dt); k.blind = Math.max(0, k.blind - dt); k.shield = Math.max(0, k.shield - dt); k.itemCd = Math.max(0, k.itemCd - dt);
    if (k.hop > 0) k.hop = Math.max(0, k.hop - dt * 3);
    // inputs (AI writes into a local input)
    let inp: Input = k.ai || this.autopilot ? this.aiInput(k) : this.input;
    if (!racing || k.finished) inp = { left: false, right: false, accel: k.finished, brake: false, drift: false, item: false };
    const s = this.surfAt(k.x, k.y);
    const surfMul = s === SURF.grass ? 0.5 : s === SURF.sand ? 0.7 : s === SURF.shoulder ? 0.86 : 1;
    const top = 122 * ch.top * surfMul * (k.finished ? 0.7 : 1) * (k.ai ? this.rubber(k) : 1);
    if (k.spin > 0) {
      k.spin -= dt; k.h += dt * 9; k.speed = Math.max(0, k.speed - dt * 220); k.steer = 0;
    } else {
      // steering
      const want = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      k.steer += (want - k.steer) * Math.min(1, dt * 12);
      // drift: hold while steering → hop, then tighter turn and charge
      if (inp.drift && k.drift === 0 && Math.abs(want) > 0 && k.speed > 60) { k.drift = want as 1 | -1; k.driftT = 0; k.hop = 1; this.sfx("hop"); }
      if (k.drift !== 0) { if (!inp.drift || k.speed < 40) { if (k.driftT > 0.9) { k.boost = Math.max(k.boost, Math.min(1.1, 0.35 + k.driftT * 0.35)); this.sfx("turbo"); this.puff(k); } k.drift = 0; k.driftT = 0; } else k.driftT += dt; }
      const turn = (k.drift !== 0 ? 2.9 : 2.1) * ch.handling * Math.min(1, k.speed / 90 + 0.25);
      const steerIn = k.drift !== 0 ? k.drift * 0.65 + k.steer * 0.55 : k.steer;
      k.h += steerIn * turn * dt;
      // throttle
      const accel = 80 * ch.accel;
      if (inp.accel) k.speed += accel * dt; else if (inp.brake) k.speed -= 160 * dt; else k.speed -= 40 * dt;
      if (k.speed > top) k.speed -= Math.min(k.speed - top, (k.boost > 0 ? 80 : 240) * dt);
      k.speed = Math.max(k.ai ? 0 : -50, k.speed);
    }
    if (k.boost > 0) { k.boost -= dt; k.speed = Math.max(k.speed, top * 1.45); }
    if (s === SURF.boost && k.boost < 0.6) { k.boost = 0.9; this.sfx("boost"); }
    // move with wall check
    const nx = k.x + Math.cos(k.h) * k.speed * dt, ny = k.y + Math.sin(k.h) * k.speed * dt;
    const ns = this.surfAt(nx, ny);
    if (ns === SURF.wall || nx < 8 || ny < 8 || nx > MAP - 8 || ny > MAP - 8) { k.speed *= -0.35; this.sfx(k === this.me ? "bump" : ""); if (k === this.me) this.shake = 0.5; }
    else { k.x = nx; k.y = ny; }
    if (ns === SURF.liquid && k.respawn <= 0) { k.respawn = 1.4; k.spin = 0; k.drift = 0; k.boost = 0; k.item = k.item; this.fx.push({ kind: "puff", x: k.x, y: k.y, life: 0.6 }); if (k === this.me) { this.sfx("splash"); this.shake = 1; } }
    // slicks
    for (const d of this.drops) { if (Math.hypot(d.x - k.x, d.y - k.y) < 14 && k.invuln <= 0) { this.hit(k, 0.9, "slick"); d.life = 0; } }
    // progress
    k.cp = this.nearestCp(k.x, k.y, k.cp, 14);
    const prevProg = k.prog; const c = this.centerAt(k.cp), c1 = this.centerAt(k.cp + 1); const dx = c1[0] - c[0], dy = c1[1] - c[1]; const L2 = dx * dx + dy * dy || 1;
    const frac = Math.max(-0.5, Math.min(1.5, ((k.x - c[0]) * dx + (k.y - c[1]) * dy) / L2));
    const raw = k.cp + frac;
    // lap crossing: from the end of the loop to the start
    const prevRaw = prevProg - k.lap * this.N;
    if (prevRaw > this.N * 0.85 && raw < this.N * 0.15) { k.lap++; if (k === this.me) { if (k.lap >= this.track.laps) this.finish(k); else if (k.lap > 0) { this.msg = k.lap === this.track.laps - 1 ? "FINAL LAP" : `LAP ${k.lap + 1}`; this.msgT = 1.8; this.sfx("lap"); } } else if (k.lap >= this.track.laps) this.finish(k); }
    else if (prevRaw < this.N * 0.15 && raw > this.N * 0.85 && k.lap > -1) k.lap--;
    k.prog = k.lap * this.N + raw;
    // item use
    if (inp.item && !k.prevInputItem && k.item && k.roulette <= 0 && racing && !k.finished) this.useItem(k);
    k.prevInputItem = inp.item;
    if (k.roulette > 0) { k.roulette -= dt; if (k.roulette <= 0) { k.item = this.rollItem(k.rank); if (k === this.me) this.sfx("item"); } }
  }
  rubber(k: Kart) {
    // rubber band: rivals behind the player get faster, rivals far ahead ease off
    const d = (this.me.prog - k.prog) / this.N;   // laps of gap; positive = behind the player
    return k.aiSkill * (1 + Math.max(-0.1, Math.min(0.18, d * 0.6)));
  }
  aiInput(k: Kart): Input {
    const look = 6 + Math.floor(k.speed / 40); const tgt = this.centerAt(k.cp + look); const tn = this.centerAt(k.cp + look + 1);
    const nx = -(tn[1] - tgt[1]), ny = tn[0] - tgt[0]; const L = Math.hypot(nx, ny) || 1;
    const lane = k.lane * this.track.width * 0.35 + Math.sin(this.t * 0.7 + k.aiNoise) * 6;
    const tx = tgt[0] + (nx / L) * lane, ty = tgt[1] + (ny / L) * lane;
    let a = Math.atan2(ty - k.y, tx - k.x) - k.h; while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2;
    // avoid slicks ahead
    for (const d of this.drops) { const ddx = d.x - k.x, ddy = d.y - k.y; const dist = Math.hypot(ddx, ddy); if (dist < 70) { let da = Math.atan2(ddy, ddx) - k.h; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2; if (Math.abs(da) < 0.35) a += da > 0 ? -0.6 : 0.6; } }
    const sharp = Math.abs(a) > 0.55 && k.speed > 100;
    const useItem = !!k.item && k.itemCd <= 0 && Math.random() < 0.02 && (k.item !== "shield" || Math.random() < 0.3);
    return { left: a < -0.06, right: a > 0.06, accel: this.state !== "countdown" || this.stateT > 2.7, brake: false, drift: sharp && Math.abs(a) > 0.7, item: useItem };
  }
  collideKarts() {
    for (let i = 0; i < this.karts.length; i++) for (let j = i + 1; j < this.karts.length; j++) {
      const a = this.karts[i], b = this.karts[j]; if (a.respawn > 0 || b.respawn > 0) continue;
      const dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy); if (d < 16 && d > 0.01) {
        const wa = CHASSIS.find((c) => c.id === a.chassis)!.weight, wb = CHASSIS.find((c) => c.id === b.chassis)!.weight; const push = (16 - d) / 2;
        const fa = wb / (wa + wb), fb = wa / (wa + wb);
        a.x -= (dx / d) * push * 2 * fa; a.y -= (dy / d) * push * 2 * fa; b.x += (dx / d) * push * 2 * fb; b.y += (dy / d) * push * 2 * fb;
        const sa = a.speed, sb = b.speed; a.speed = sa * 0.9 + sb * 0.05 * fa; b.speed = sb * 0.9 + sa * 0.05 * fb;
        if (a === this.me || b === this.me) this.sfx("bump");
      }
    }
  }
  stepBoxes(dt: number) {
    for (const b of this.boxes) { if (b.t > 0) { b.t -= dt; continue; } for (const k of this.karts) if (!k.item && k.roulette <= 0 && Math.hypot(b.x - k.x, b.y - k.y) < 14) { b.t = 4; k.roulette = 1.1; if (k === this.me) this.sfx("box"); this.fx.push({ kind: "star", x: b.x, y: b.y, life: 0.4 }); break; } }
  }
  stepDrops(dt: number) { for (const d of this.drops) d.life -= dt; this.drops = this.drops.filter((d) => d.life > 0); }
  stepHazards(dt: number) {
    for (const h of this.hazards) {
      if (h.kind === "spider" || h.kind === "boulder") { const f = (Math.sin((this.t / h.period) * Math.PI * 2 + (h.phase || 0)) + 1) / 2; h.x = h.a[0] + (h.b[0] - h.a[0]) * f; h.y = h.a[1] + (h.b[1] - h.a[1]) * f; h.r = h.kind === "spider" ? 13 : 15; h.active = true; }
      else if (h.kind === "crusher") { const ph = ((this.t / h.period) + h.phase) % 1; h.active = ph > 0.42 && ph < 0.6; h.lift = ph < 0.42 ? 1 - ph / 0.42 : ph < 0.6 ? 0 : (ph - 0.6) / 0.4; }
      else if (h.kind === "geyser") { const ph = ((this.t / h.period) + h.phase) % 1; h.active = ph > 0.55 && ph < 0.75; h.lift = h.active ? 1 : 0; }
      if (h.active) for (const k of this.karts) if (k.invuln <= 0 && k.respawn <= 0 && Math.hypot(h.x - k.x, h.y - k.y) < (h.r || 20) + 6) this.hit(k, h.kind === "crusher" ? 1.4 : 1.0, h.kind);
    }
  }
  stepProjs(dt: number) {
    for (const p of this.projs) {
      p.life -= dt;
      if (p.kind === "wasp" || p.kind === "wrath") {
        const tgt = this.karts[p.target]; if (tgt && tgt.respawn <= 0) { let a = Math.atan2(tgt.y - p.y, tgt.x - p.x) - p.h; while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; p.h += Math.max(-4 * dt, Math.min(4 * dt, a)); }
      }
      const nx = p.x + Math.cos(p.h) * p.speed * dt, ny = p.y + Math.sin(p.h) * p.speed * dt; const s = this.surfAt(nx, ny);
      if (s === SURF.wall || nx < 4 || ny < 4 || nx > MAP - 4 || ny > MAP - 4) { if (p.kind === "shell" && p.bounces-- > 0) { p.h += Math.PI + (Math.random() - 0.5) * 0.6; } else p.life = 0; continue; }
      if (p.kind === "shell" && (s === SURF.grass || s === SURF.liquid)) p.speed = Math.max(60, p.speed - dt * 200);
      p.x = nx; p.y = ny;
      for (const k of this.karts) { if (k.id === p.owner && p.life > 4.4) continue; if (k.respawn > 0 || k.invuln > 0) continue; if (Math.hypot(k.x - p.x, k.y - p.y) < 14) { this.hit(k, p.kind === "wrath" ? 1.6 : 1.0, p.kind); p.life = 0; break; } }
    }
    this.projs = this.projs.filter((p) => p.life > 0);
  }
  hit(k: Kart, spin: number, from: string) {
    if (k.shield > 0) { k.shield = 0; k.invuln = 0.8; this.fx.push({ kind: "star", x: k.x, y: k.y, life: 0.4 }); if (k === this.me) this.sfx("shieldpop"); return; }
    k.spin = Math.max(k.spin, spin); k.drift = 0; k.boost = 0; k.invuln = spin + 0.6; k.speed *= 0.35;
    if (from === "spore") { k.blind = 2.6; k.spin = 0; k.speed *= 0.9; }
    this.fx.push({ kind: "star", x: k.x, y: k.y, life: 0.6 });
    if (k === this.me) { this.sfx(from === "spore" ? "spore" : "hit"); this.shake = 1; }
  }
  rollItem(rank: number): ItemId {
    const table = ITEM_TABLE[Math.max(1, Math.min(8, rank))]; let tot = 0; for (const v of Object.values(table)) tot += v || 0;
    let r = Math.random() * tot; for (const [id, w] of Object.entries(table)) { r -= w || 0; if (r <= 0) return id as ItemId; }
    return "slick";
  }
  useItem(k: Kart) {
    const it = k.item!; k.item = null; k.itemCd = 1.5;
    if (k === this.me) this.sfx("use");
    switch (it) {
      case "slick": this.drops.push({ kind: "slick", x: k.x - Math.cos(k.h) * 22, y: k.y - Math.sin(k.h) * 22, life: 25 }); break;
      case "shell": this.projs.push({ kind: "shell", x: k.x + Math.cos(k.h) * 18, y: k.y + Math.sin(k.h) * 18, h: k.h, speed: 300, life: 5, owner: k.id, target: -1, bounces: 3 }); break;
      case "wasp": { const ahead = this.karts.filter((o) => o !== k && o.prog > k.prog && !o.finished).sort((a, b) => a.prog - b.prog)[0]; this.projs.push({ kind: "wasp", x: k.x, y: k.y, h: k.h, speed: 260, life: 6, owner: k.id, target: ahead ? ahead.id : -1, bounces: 0 }); break; }
      case "wrath": { const first = [...this.karts].sort((a, b) => a.rank - b.rank).find((o) => o !== k) || k; this.projs.push({ kind: "wrath", x: k.x, y: k.y, h: k.h, speed: 340, life: 9, owner: k.id, target: first.id, bounces: 0 }); this.msg = k === this.me ? "QUEEN'S WRATH!" : "☠ QUEEN'S WRATH INCOMING"; this.msgT = 1.6; this.sfx("wrath"); break; }
      case "spore": for (const o of this.karts) if (o !== k && Math.hypot(o.x - k.x, o.y - k.y) < 130) this.hit(o, 0, "spore"); this.fx.push({ kind: "puff", x: k.x, y: k.y, life: 0.8 }); break;
      case "nectar": k.boost = 1.5; this.puff(k); this.sfx("boost"); break;
      case "shield": k.shield = 9; break;
    }
  }
  puff(k: Kart) { this.fx.push({ kind: "puff", x: k.x - Math.cos(k.h) * 14, y: k.y - Math.sin(k.h) * 14, life: 0.4 }); }
  rank() {
    const sorted = [...this.karts].sort((a, b) => (b.finished ? 1e9 - b.finishT : b.prog) - (a.finished ? 1e9 - a.finishT : a.prog));
    sorted.forEach((k, i) => { k.rank = i + 1; });
  }
  finish(k: Kart) {
    if (k.finished) return; k.finished = true; k.finishT = this.t; this.finishedCount++;
    if (k === this.me) { this.rank(); this.setState("finished", `${ord(k.rank)} PLACE`); this.sfx(k.rank <= 3 ? "win" : "lose"); setTimeout(() => { if (!this.over) { this.stop(); this.cb.onEnd({ place: k.rank, time: this.t, laps: this.track.laps }); } }, 3200); }
  }

  pushHud() {
    const me = this.me; const rel = this.track.width;
    this.cb.onHud({
      lap: Math.max(1, Math.min(this.track.laps, me.lap + 1)), laps: this.track.laps, rank: me.rank, item: me.item, roulette: me.roulette > 0, speed: me.speed, t: this.state === "race" || this.state === "finished" ? this.stateT : 0,
      state: this.state, countdown: this.countdown, blind: me.blind, boostLeft: me.boost,
      standings: [...this.karts].sort((a, b) => a.rank - b.rank).map((k) => ({ name: k.name, faction: k.faction, rank: k.rank, finished: k.finished, you: k === me })),
      minimap: this.karts.map((k) => ({ x: k.x / MAP, y: k.y / MAP, you: k === me })), msg: this.msg,
    });
    void rel;
  }

  // ── rendering
  render() {
    const c = this.ctx; const b = this.buf32; const cosH = Math.cos(this.camH), sinH = Math.sin(this.camH);
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 5 : 0, sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 3 : 0;
    // sky (parallax by heading)
    c.fillStyle = "#0a0f1c"; c.fillRect(0, 0, this.vw, HORIZON);
    if (this.sky.complete && this.sky.naturalWidth) { const off = ((Math.floor((this.camH / (Math.PI * 2)) * 960) % 480) + 480) % 480; for (let k = -1; k * 480 - off < this.vw; k++) c.drawImage(this.sky, 0, 0, 480, 225, k * 480 - off, HORIZON + 12 - 225, 480, 225); }
    if (this.skyMid.complete && this.skyMid.naturalWidth) { const off = ((Math.floor((this.camH / (Math.PI * 2)) * 1920) % 480) + 480) % 480; for (let k = -1; k * 480 - off < this.vw; k++) c.drawImage(this.skyMid, 0, 105, 480, 120, k * 480 - off, HORIZON + 6 - 120, 480, 120); }
    // ground: one scanline at a time
    const map = this.map, MASKB = MMASK;
    for (let y = HORIZON; y < VH; y++) {
      const z = (CAM_H * FOCAL) / (y - HORIZON + 1);            // distance of this row
      const wx = this.camX + cosH * z, wy = this.camY + sinH * z;  // world point at screen centre
      const step = z / FOCAL;                                     // world units per screen pixel
      const dxs = -sinH * step, dys = cosH * step;               // "right" vector on screen → world
      let fx = wx - dxs * (this.vw / 2) + sx * step, fy = wy - dys * (this.vw / 2) + sy * step; let o = y * this.vw;
      for (let x = 0; x < this.vw; x++) { b[o++] = map[(((fy | 0) & MASKB) << 10) | ((fx | 0) & MASKB)]; fx += dxs; fy += dys; }
    }
    c.putImageData(this.buf, 0, 0, 0, HORIZON, this.vw, VH - HORIZON);
    // horizon haze
    const g = c.createLinearGradient(0, HORIZON, 0, HORIZON + 26); g.addColorStop(0, "rgba(10,15,28,0.85)"); g.addColorStop(1, "rgba(10,15,28,0)"); c.fillStyle = g; c.fillRect(0, HORIZON, this.vw, 26);
    // sprites, far → near
    type S = { z: number; draw: () => void };
    const S: S[] = [];
    const proj = (x: number, y: number) => { const dx = x - this.camX, dy = y - this.camY; const z = dx * cosH + dy * sinH; const lat = -dx * sinH + dy * cosH; return { z, lat }; };
    const put = (x: number, y: number, sheet: HTMLImageElement, fx: number, fy: number, fw: number, fh: number, worldH: number, lift = 0, alpha = 1) => {
      const { z, lat } = proj(x, y); if (z < 6 || z > 900) return;
      const sc = FOCAL / z; const px = this.vw / 2 + lat * sc + sx, base = HORIZON + CAM_H * sc + sy; const h = worldH * sc; const w = h * (fw / fh);
      if (px < -w || px > this.vw + w) return;
      S.push({ z, draw: () => { if (alpha < 1) c.globalAlpha = alpha; c.drawImage(sheet, fx, fy, fw, fh, Math.round(px - w / 2), Math.round(base - h - lift * sc), Math.round(w), Math.round(h)); if (alpha < 1) c.globalAlpha = 1; } });
    };
    const P = this.props, ok = P.complete && P.naturalWidth > 0;
    const prop = (x: number, y: number, id: number, worldH: number, lift = 0, alpha = 1) => { if (ok) put(x, y, P, (id % 8) * 64, Math.floor(id / 8) * 64, 64, 64, worldH, lift, alpha); };
    const DEC: Record<string, number> = { tree: this.track.biome === "garden" ? PROP.tree2 : PROP.tree, rock: this.track.biome === "fortress" ? PROP.rock2 : PROP.rock, mushroom: PROP.mushroom, pipe: PROP.pipe, barrel: PROP.barrel, torch: PROP.torch, pillar: PROP.pillar, crystal: this.track.biome === "throne" ? PROP.crystal : PROP.crystal2, egg: PROP.egg, flower: PROP.flower, fence: PROP.fence };
    for (const [x, y, kind] of this.track.decor) prop(x, y, DEC[kind] ?? PROP.rock, kind === "tree" ? 46 : kind === "pillar" || kind === "pipe" ? 40 : kind === "flower" || kind === "mushroom" ? 18 : 24);
    for (const bx of this.boxes) if (bx.t <= 0) prop(bx.x, bx.y, PROP.itembox, 14, 5 + Math.sin(this.t * 3) * 2);
    for (const d of this.drops) prop(d.x, d.y, PROP.slick, 7);
    for (const h of this.hazards) {
      if (h.kind === "spider") prop(h.x, h.y, PROP.spider, 20);
      else if (h.kind === "boulder") prop(h.x, h.y, PROP.boulder, 24, 0);
      else if (h.kind === "crusher") prop(h.x, h.y, PROP.crusher, 34, 3 + (h.lift ?? 1) * 30);
      else if (h.kind === "geyser") { if (h.active) prop(h.x, h.y, PROP.geyser, 40); }
    }
    for (const p of this.projs) prop(p.x, p.y, p.kind === "shell" ? PROP.shell : p.kind === "wasp" ? PROP.wasp : PROP.wrath, p.kind === "wrath" ? 20 : 12, p.kind === "shell" ? 0 : 8 + Math.sin(this.t * 8) * 3);
    for (const f of this.fx) prop(f.x, f.y, f.kind === "star" ? PROP.star : PROP.puff, f.kind === "star" ? 16 : 14, f.kind === "star" ? 8 + (0.6 - f.life) * 24 : 3, Math.min(1, f.life * 2));
    for (const k of this.karts) {
      if (k.respawn > 0 && k.respawn < 1.0) continue;
      const sh = this.kartImg[k.faction + k.chassis]; if (!sh || !sh.complete || !sh.naturalWidth) continue;
      let rel = k.h - this.camH; if (k.spin > 0) rel += k.spin * 6; let fi = Math.round((rel / (Math.PI * 2)) * 16); fi = ((fi % 16) + 16) % 16;
      const flicker = k.invuln > 0 && k.spin <= 0 && Math.floor(this.t * 16) % 2 === 0;
      if (!flicker) put(k.x, k.y, sh, fi * 96, 0, 96, 96, 20, k.hop > 0 ? Math.sin(k.hop * Math.PI) * 6 : 0);
      if (k.shield > 0) prop(k.x, k.y, PROP.shield, 26, -1, 0.55);
      if (k.drift !== 0 && k.driftT > 0.9) prop(k.x - Math.cos(k.h) * 10, k.y - Math.sin(k.h) * 10, PROP.star, 7 + Math.sin(this.t * 30) * 2, 1, 0.9);
    }
    S.sort((a, b) => b.z - a.z); for (const s of S) s.draw();
    // speed lines when boosting
    if (this.me.boost > 0) { c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 1; for (let i = 0; i < 10; i++) { const y = HORIZON + Math.random() * (VH - HORIZON); const x = Math.random() < 0.5 ? Math.random() * 90 : this.vw - Math.random() * 90; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (x < this.vw / 2 ? -30 : 30), y); c.stroke(); } }
    if (this.me.blind > 0) { c.fillStyle = `rgba(120,70,160,${Math.min(0.85, this.me.blind * 0.5)})`; c.fillRect(0, 0, this.vw, VH); }
    if (this.state === "intro") { c.fillStyle = `rgba(0,0,0,${Math.max(0, 1 - this.stateT / 0.9)})`; c.fillRect(0, 0, this.vw, VH); }
  }
}

function ord(n: number) { return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`; }
function mulberry(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export { ord, GP_LAPS };
