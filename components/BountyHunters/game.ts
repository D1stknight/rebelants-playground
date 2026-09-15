// components/BountyHunters/game.ts
// Bounty Hunters — canvas-2D run-and-gun engine. Fixed 400×225 internal resolution, nearest-neighbour upscale.
// Pure game logic + rendering; React only mounts the canvas and forwards input (see BountyGame.tsx).
import { BOARDS, BOUNTY_LIVES, KILL_BOUNTY, type Board } from "../../lib/bountyConfig";
import { buildLevel, ROWS, TILE, type Level, type Spawn } from "./levels";

export const VW = 400, VH = 225;
const GRAV = 640, PSPEED = 92, JUMP = 262, BULLET = 280;

export type Weapon = "rifle" | "spread" | "laser" | "flame";
export type Input = { left: boolean; right: boolean; up: boolean; down: boolean; jump: boolean; fire: boolean };
export type Hud = { lives: number; weapon: Weapon; bounty: number; board: Board; bossHp: number | null; bossMax: number; kills: number; progress: number; state: GameState; msg: string | null };
export type GameState = "intro" | "play" | "dying" | "boss" | "cleared" | "gameover";
export type Callbacks = { onHud: (h: Hud) => void; onSfx: (name: string) => void; onEnd: (r: { cleared: boolean; bounty: number; kills: number; boardN: number }) => void };

type Ent = {
  kind: Spawn["kind"] | "player" | "bullet" | "ebullet" | "item" | "fx";
  x: number; y: number; w: number; h: number; vx: number; vy: number;
  hp: number; dir: 1 | -1; t: number; state: string; dead: boolean; ground: boolean;
  data: any;
};

type Sheet = { img: HTMLImageElement; fw: number; fh: number; cols: number };

const sheets: Record<string, Sheet> = {};
function load(name: string, fw: number, fh: number, cols: number) {
  if (sheets[name]) return sheets[name];
  const img = new Image(); img.src = `/bounty/${name}.png`;
  return (sheets[name] = { img, fw, fh, cols });
}
export function preloadBoard(board: Board, faction = "samurai") {
  [`hunter_${faction}`, "grunt", "elite", "wasp", "turret", "items", `boss_${board.boss.id}`, `tiles_${board.id}`, `bg_${board.id}_far`, `bg_${board.id}_mid`, `bg_${board.id}_near`].forEach((n) => { const i = new Image(); i.src = `/bounty/${n}.png`; });
}

export class BountyGame {
  ctx: CanvasRenderingContext2D;
  board: Board; level: Level;
  ents: Ent[] = []; player: Ent;
  cam = 0; camLock: number | null = null;
  state: GameState = "intro"; stateT = 0;
  lives = BOUNTY_LIVES; bounty = 0; kills = 0; weapon: Weapon = "rifle";
  input: Input = { left: false, right: false, up: false, down: false, jump: false, fire: false };
  prevJump = false; fireCd = 0; invuln = 0; shake = 0; flash = 0; t = 0; checkpoint = 0;
  boss: Ent | null = null; msg: string | null = null; hitStop = 0;
  cb: Callbacks; raf = 0; last = 0; acc = 0; over = false;
  parts: { x: number; y: number; vx: number; vy: number; life: number; c: string; s: number }[] = [];
  hud: Sheet; hunter: Sheet; items: Sheet; tiles: Sheet; bg: Sheet[]; bossSheet: Sheet;

  constructor(canvas: HTMLCanvasElement, board: Board, cb: Callbacks, faction = "samurai") {
    this.ctx = canvas.getContext("2d")!; this.ctx.imageSmoothingEnabled = false;
    this.board = board; this.cb = cb; this.level = buildLevel(board);
    this.hunter = load(`hunter_${faction}`, 64, 64, 10); this.items = load("items", 16, 16, 15); this.hud = this.items;
    this.tiles = load(`tiles_${board.id}`, 16, 16, 11);
    this.bg = [load(`bg_${board.id}_far`, 480, 225, 1), load(`bg_${board.id}_mid`, 480, 225, 1), load(`bg_${board.id}_near`, 480, 64, 1)];
    this.bossSheet = load(`boss_${board.boss.id}`, 64, 64, 6);
    load("grunt", 64, 64, 7); load("elite", 64, 64, 7); load("wasp", 32, 32, 5); load("turret", 32, 32, 4);
    this.player = this.mk("player", this.level.startX, 9 * TILE, 14, 38); this.player.hp = 1; this.checkpoint = this.level.startX; this.invuln = 2.5;
    for (const s of this.level.spawns) this.spawn(s);
    this.pushHud();
  }

  mk(kind: Ent["kind"], x: number, y: number, w: number, h: number): Ent {
    const e: Ent = { kind, x, y, w, h, vx: 0, vy: 0, hp: 1, dir: 1, t: 0, state: "idle", dead: false, ground: false, data: {} };
    this.ents.push(e); return e;
  }
  spawn(s: Spawn) {
    switch (s.kind) {
      case "grunt": { const e = this.mk("grunt", s.x, s.y - 22, 14, 38); e.hp = 2; e.dir = -1; e.data.shootCd = 1 + Math.random(); break; }
      case "elite": { const e = this.mk("elite", s.x, s.y - 22, 14, 38); e.hp = 4; e.dir = -1; e.data.shootCd = 1; break; }
      case "wasp": { const e = this.mk("wasp", s.x, s.y, 22, 16); e.hp = 1; e.data.baseY = s.y; e.data.ph = Math.random() * 6; break; }
      case "turret": { const e = this.mk("turret", s.x, s.y + 2, 26, 26); e.hp = 3; e.data.shootCd = 1.5; break; }
      case "crate": { const e = this.mk("crate", s.x, s.y, 16, 16); e.hp = 1; break; }
      case "heart": { const e = this.mk("item", s.x, s.y - 2, 12, 12); e.data.item = 5; break; }
      case "boss": { const e = this.mk("boss", s.x, s.y, 52, 40); e.hp = this.board.boss.hp; e.dir = -1; e.state = "sleep"; e.data.pat = 0; this.boss = e; break; }
    }
  }

  // ── tiles
  tile(tx: number, ty: number) { if (ty >= ROWS) return 1; if (ty < 0 || tx < 0 || tx >= this.level.cols) return tx < 0 ? 1 : 0; return this.level.tiles[ty * this.level.cols + tx]; }
  solidAt(x: number, y: number) { const v = this.tile(Math.floor(x / TILE), Math.floor(y / TILE)); return v === 1; }
  spikeAt(x: number, y: number) { return this.tile(Math.floor(x / TILE), Math.floor(y / TILE)) === 3; }

  // move an entity with tile collision (AABB, one-way platforms)
  move(e: Ent, dt: number, oneWay = true) {
    e.ground = false;
    // horizontal
    let nx = e.x + e.vx * dt;
    if (e.vx !== 0) {
      const xe = e.vx > 0 ? nx + e.w : nx;
      if (this.solidAt(xe, e.y + 1) || this.solidAt(xe, e.y + e.h / 2) || this.solidAt(xe, e.y + e.h - 1)) { nx = e.vx > 0 ? Math.floor(xe / TILE) * TILE - e.w - 0.01 : (Math.floor(xe / TILE) + 1) * TILE + 0.01; e.vx = 0; }
    }
    e.x = nx;
    // vertical
    let ny = e.y + e.vy * dt;
    if (e.vy > 0) {
      const ye = ny + e.h; const oldBottom = e.y + e.h;
      const xs = [e.x + 1, e.x + e.w / 2, e.x + e.w - 1];
      let hit = false;
      for (const xx of xs) {
        const tv = this.tile(Math.floor(xx / TILE), Math.floor(ye / TILE));
        const tileTop = Math.floor(ye / TILE) * TILE;
        if (tv === 1 || (oneWay && tv === 2 && oldBottom <= tileTop + 0.5 && !e.data.dropThrough)) { hit = true; ny = tileTop - e.h; break; }
      }
      if (hit) { e.vy = 0; e.ground = true; }
    } else if (e.vy < 0) {
      const ye = ny;
      if (this.solidAt(e.x + 1, ye) || this.solidAt(e.x + e.w - 1, ye)) { ny = (Math.floor(ye / TILE) + 1) * TILE; e.vy = 0; }
    }
    e.y = ny;
  }

  // ── loop
  start() { this.last = performance.now(); const loop = (now: number) => { if (this.over) return; const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.acc += dt; while (this.acc >= 1 / 120) { this.step(1 / 120); this.acc -= 1 / 120; } this.render(); this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop); }
  stop() { this.over = true; cancelAnimationFrame(this.raf); }

  pushHud() { this.cb.onHud({ lives: this.lives, weapon: this.weapon, bounty: this.bounty, board: this.board, bossHp: this.boss && this.state === "boss" ? Math.max(0, this.boss.hp) : null, bossMax: this.board.boss.hp, kills: this.kills, progress: Math.min(1, this.player.x / this.level.bossX), state: this.state, msg: this.msg }); }
  setState(s: GameState, msg: string | null = null) { this.state = s; this.stateT = 0; this.msg = msg; this.pushHud(); }
  sfx(n: string) { this.cb.onSfx(n); }

  burst(x: number, y: number, n: number, c: string, sp = 80, s = 2) { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = sp * (0.4 + Math.random()); this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.4 + Math.random() * 0.4, c, s }); } }

  step(dt: number) {
    this.t += dt; this.stateT += dt;
    if (this.hitStop > 0) { this.hitStop -= dt; return; }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 6);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
    if (this.state === "intro") { if (this.stateT > 1.6) this.setState("play"); }
    if (this.state === "cleared" || this.state === "gameover") { this.updateParts(dt); if (this.stateT > 2.6) { this.stop(); this.cb.onEnd({ cleared: this.state === "cleared", bounty: this.bounty, kills: this.kills, boardN: this.board.n }); } return; }
    const p = this.player;
    // ── player
    if (this.state === "dying") {
      p.vy += GRAV * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.t += dt;
      if (this.stateT > 1.4) { this.lives--; this.pushHud(); if (this.lives <= 0) { this.setState("gameover", "THE HIVE COLLECTS"); this.sfx("lose"); } else { this.respawn(); } }
    } else if (this.state === "play" || this.state === "boss") {
      const inp = this.input; const crouch = inp.down && p.ground && !inp.left && !inp.right;
      p.vx = crouch ? 0 : inp.left ? -PSPEED : inp.right ? PSPEED : 0;
      if (inp.left) p.dir = -1; if (inp.right) p.dir = 1;
      if (inp.jump && !this.prevJump && p.ground) { if (inp.down && this.tile(Math.floor((p.x + p.w / 2) / TILE), Math.floor((p.y + p.h + 1) / TILE)) === 2) { p.data.dropThrough = 0.25; } else { p.vy = -JUMP; this.sfx("jump"); } }
      if (!inp.jump && p.vy < -80) p.vy = -80;   // variable jump height
      this.prevJump = inp.jump;
      if (p.data.dropThrough > 0) p.data.dropThrough -= dt; else p.data.dropThrough = 0;
      p.vy = Math.min(420, p.vy + GRAV * dt);
      this.move(p, dt);
      p.data.crouch = crouch;
      // aim
      const aim = inp.up ? (inp.left || inp.right ? 45 : 90) : (inp.down && !p.ground ? -45 : 0);
      p.data.aim = aim;
      // fire
      this.fireCd -= dt;
      if (inp.fire && this.fireCd <= 0) { this.shoot(p, aim, crouch); }
      if (this.invuln > 0) this.invuln -= dt;
      // hazards
      if (p.y > ROWS * TILE + 20 || this.spikeAt(p.x + p.w / 2, p.y + p.h - 2)) this.kill();
      // camera / boss trigger
      if (this.state === "play" && p.x >= this.level.bossX) { this.camLock = this.level.bossX - 40; this.setState("boss", `WANTED · ${this.board.boss.name}`); if (this.boss) this.boss.state = "enter"; this.sfx("ambush"); }
      if (p.ground && this.state === "play" && !this.spikeAt(p.x + p.w / 2, p.y + p.h + 2)) { if (Math.floor(p.x / 64) !== Math.floor(this.checkpoint / 64)) this.checkpoint = p.x; }
      if (this.camLock != null) { p.x = Math.max(this.camLock + 2, Math.min(this.camLock + VW - p.w - 2, p.x)); }
    }
    // ── entities
    for (const e of this.ents) {
      if (e.dead || e === p) continue;
      e.t += dt;
      const dx = p.x - e.x; const onScreen = e.x + e.w > this.cam - 24 && e.x < this.cam + VW + 24;
      if (onScreen && e.data.awake == null) e.data.awake = 0; if (e.data.awake != null) e.data.awake += dt;
      const near = onScreen && e.data.awake > 0.5 && this.state !== "intro";
      switch (e.kind) {
        case "grunt": case "elite": {
          if (e.hp <= 0) { e.state = "dead"; e.t += 0; if (e.t > 1.2) e.dead = true; break; }
          if (!near) break;
          e.dir = dx < 0 ? -1 : 1;
          const speed = e.kind === "elite" ? 46 : 34;
          const far = Math.abs(dx) > 120;
          e.vx = far ? e.dir * speed : (Math.abs(dx) < 40 ? -e.dir * speed * 0.6 : 0);
          // don't walk off ledges
          const aheadX = e.x + (e.vx > 0 ? e.w + 2 : -2);
          if (e.vx !== 0 && !this.solidAt(aheadX, e.y + e.h + 4) && e.ground) e.vx = 0;
          e.vy = Math.min(420, e.vy + GRAV * dt); this.move(e, dt);
          e.data.shootCd -= dt;
          if (e.data.shootCd <= 0 && Math.abs(dx) < 200 && Math.abs(p.y - e.y) < 48 && this.state !== "dying") {
            e.data.shootCd = e.kind === "elite" ? 1.4 : 2.2 - this.board.difficulty * 0.2; e.data.flash = 0.15;
            const n = e.kind === "elite" ? 2 : 1;
            for (let i = 0; i < n; i++) { const b = this.mk("ebullet", e.x + (e.dir > 0 ? e.w : -6), e.y + 14, 6, 6); b.vx = e.dir * (120 + this.board.difficulty * 8); b.vy = (i - (n - 1) / 2) * 40; b.data.life = 3; }
            this.sfx("eshot");
          }
          if (e.data.flash > 0) e.data.flash -= dt;
          this.touch(e, 1);
          break;
        }
        case "wasp": {
          if (e.hp <= 0) { e.vy += GRAV * 0.6 * dt; e.y += e.vy * dt; if (e.y > ROWS * TILE) e.dead = true; break; }
          if (!near) break;
          const ph = e.data.ph + this.t * 3;
          const tx = p.x - (dx > 0 ? 24 : -24);
          e.vx += ((tx - e.x) * 1.6 - e.vx) * dt * 1.2; e.vx = Math.max(-110, Math.min(110, e.vx));
          const ty = Math.min(e.data.baseY + 30, Math.max(20, p.y - 40 + Math.sin(ph) * 22));
          e.vy = (ty - e.y) * 2.4;
          e.x += e.vx * dt; e.y += e.vy * dt; e.dir = e.vx < 0 ? -1 : 1;
          this.touch(e, 1);
          break;
        }
        case "turret": {
          if (e.hp <= 0) { e.state = "dead"; if (e.t > 0.6) e.dead = true; break; }
          if (!near) break;
          e.dir = dx < 0 ? -1 : 1;
          e.data.shootCd -= dt;
          if (e.data.shootCd <= 0 && this.state !== "dying") {
            e.data.shootCd = 1.7 - this.board.difficulty * 0.15; e.data.flash = 0.2;
            const a = Math.atan2(p.y + 10 - (e.y + 10), p.x - e.x); const b = this.mk("ebullet", e.x + e.w / 2 - 3, e.y + 8, 6, 6); b.vx = Math.cos(a) * 130; b.vy = Math.sin(a) * 130; b.data.life = 3; this.sfx("eshot");
          }
          if (e.data.flash > 0) e.data.flash -= dt;
          this.touch(e, 1);
          break;
        }
        case "boss": this.stepBoss(e, dt, dx); break;
        case "bullet": {
          e.x += e.vx * dt; e.y += e.vy * dt; if (e.data.gravity) e.vy += e.data.gravity * dt; e.data.life -= dt;
          if (e.data.life <= 0 || e.x < this.cam - 20 || e.x > this.cam + VW + 20 || e.y < -20 || e.y > VH + 20 || this.solidAt(e.x + e.w / 2, e.y + e.h / 2)) { if (!e.data.pierce || e.data.life <= 0 || this.solidAt(e.x + e.w / 2, e.y + e.h / 2)) { e.dead = true; if (this.solidAt(e.x + e.w / 2, e.y + e.h / 2)) this.burst(e.x, e.y, 3, "#ffe9a0", 40, 1); } }
          for (const o of this.ents) {
            if (o.dead || o.hp <= 0 || !(o.kind === "grunt" || o.kind === "elite" || o.kind === "wasp" || o.kind === "turret" || o.kind === "boss" || o.kind === "crate")) continue;
            if (o.kind === "boss" && o.state === "sleep") continue;
            if (this.overlap(e, o) && !(e.data.hitSet && e.data.hitSet.has(o))) {
              o.hp -= e.data.dmg; o.data.hurt = 0.12; this.burst(e.x + e.w / 2, e.y + e.h / 2, 4, "#fff2b0", 60, 1);
              if (e.data.pierce) { e.data.hitSet = e.data.hitSet || new Set(); e.data.hitSet.add(o); } else e.dead = true;
              if (o.hp <= 0) this.onKill(o); else this.sfx("hit");
              if (!e.data.pierce) break;
            }
          }
          break;
        }
        case "ebullet": {
          e.x += e.vx * dt; e.y += e.vy * dt; e.data.life -= dt;
          if (e.data.life <= 0 || this.solidAt(e.x + 3, e.y + 3)) e.dead = true;
          if ((this.state === "play" || this.state === "boss") && this.invuln <= 0 && this.overlap(e, this.hit(p))) { e.dead = true; this.kill(); }
          break;
        }
        case "item": {
          e.vy = Math.min(300, e.vy + GRAV * dt); this.move(e, dt); e.vx *= 0.9;
          if ((this.state === "play" || this.state === "boss") && this.overlap(e, p)) {
            e.dead = true; const it = e.data.item;
            if (it === 0) { this.bounty += 5; this.sfx("coin"); }
            else if (it === 5) { this.lives = Math.min(5, this.lives + 1); this.sfx("heal"); }
            else { this.weapon = (["", "spread", "laser", "flame", "rifle"] as Weapon[])[it]; this.sfx("power"); this.msg = this.weapon.toUpperCase() + " GUN"; setTimeout(() => { if (this.msg?.endsWith("GUN")) { this.msg = null; this.pushHud(); } }, 1400); }
            this.pushHud();
          }
          if (e.t > 12) e.dead = true;
          break;
        }
        case "crate": { if (e.hp <= 0) { e.dead = true; } break; }
      }
    }
    this.ents = this.ents.filter((e) => !e.dead);
    this.updateParts(dt);
    // camera
    const target = this.camLock != null ? this.camLock : Math.max(0, Math.min(this.level.endX - VW, p.x - VW * 0.38));
    this.cam += (target - this.cam) * Math.min(1, dt * 8);
    if (this.camLock != null) this.cam = target;
  }

  updateParts(dt: number) { for (const q of this.parts) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 200 * dt; } this.parts = this.parts.filter((q) => q.life > 0); }
  hit(p: Ent) { return p.data.crouch ? { ...p, y: p.y + 14, h: p.h - 14 } : p; }
  overlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
  touch(e: Ent, _dmg: number) { if ((this.state === "play" || this.state === "boss") && this.invuln <= 0 && e.hp > 0 && this.overlap(e, this.hit(this.player))) this.kill(); }

  shoot(p: Ent, aim: number, crouch: boolean) {
    const a = (-aim * Math.PI) / 180; const dirx = aim === 90 ? 0 : p.dir; const cx = p.x + p.w / 2 + dirx * 14, cy = p.y + (crouch ? 24 : 14);
    const fire = (ang: number, speed: number, dmg: number, extra: any = {}) => { const b = this.mk("bullet", cx - 3, cy - 3, 6, 6); b.vx = Math.cos(ang) * speed * (dirx === 0 ? 1 : 1); b.vy = Math.sin(ang) * speed; b.data = { life: 1.2, dmg, ...extra }; if (dirx === 0) { b.vx = 0; b.vy = -speed; } };
    const base = dirx < 0 ? Math.PI - a : a;
    switch (this.weapon) {
      case "rifle": fire(base, BULLET, 1); this.fireCd = 0.16; break;
      case "spread": for (const off of [-0.26, 0, 0.26]) fire(base + off, BULLET * 0.95, 1); this.fireCd = 0.24; break;
      case "laser": fire(base, BULLET * 1.7, 2, { pierce: true, laser: true, life: 0.6 }); this.fireCd = 0.3; break;
      case "flame": fire(base + (Math.random() - 0.5) * 0.2, BULLET * 0.6, 1, { flame: true, gravity: 260, life: 0.55 }); this.fireCd = 0.07; break;
    }
    p.data.muzzle = 0.08; this.sfx(this.weapon === "laser" ? "laser" : "shot");
  }

  onKill(o: Ent) {
    if (o.kind === "crate") { this.burst(o.x + 8, o.y + 8, 10, "#c8a070", 90, 2); const roll = Math.random(); const it = this.mk("item", o.x + 2, o.y, 12, 12); it.vy = -120; it.data.item = roll < 0.45 ? 0 : roll < 0.65 ? 1 : roll < 0.8 ? 2 : roll < 0.92 ? 3 : 5; this.sfx("crate"); return; }
    this.kills++; this.bounty += KILL_BOUNTY[o.kind] || 0;
    this.burst(o.x + o.w / 2, o.y + o.h / 2, 12, o.kind === "wasp" ? "#f8c840" : "#9be080", 100, 2);
    if (o.kind === "wasp") { o.vy = -60; } else if (o.kind === "boss") { this.onBossDown(o); } else { o.t = 0; }
    this.sfx(o.kind === "boss" ? "bossdie" : "kill"); this.hitStop = 0.03;
    // bounty tag pops out of anything that isn't a boss
    if (o.kind !== "boss" && Math.random() < 0.35) { const it = this.mk("item", o.x + o.w / 2 - 6, o.y, 12, 12); it.vy = -140; it.vx = (Math.random() - 0.5) * 60; it.data.item = 0; }
    this.pushHud();
  }

  kill() {
    if (this.state !== "play" && this.state !== "boss") return;
    const p = this.player; p.vx = -p.dir * 60; p.vy = -200; p.t = 0; this.shake = 1; this.flash = 1; this.hitStop = 0.08;
    this.burst(p.x + p.w / 2, p.y + p.h / 2, 16, "#ff6060", 120, 2); this.sfx("die"); this.setState("dying");
  }
  respawn() {
    const p = this.player; p.x = this.camLock != null ? this.camLock + 30 : this.checkpoint; p.y = 20; p.vx = 0; p.vy = 0; this.invuln = 2.2; this.weapon = "rifle";
    // find ground under the checkpoint
    for (let y = 0; y < ROWS; y++) { if (this.tile(Math.floor((p.x + p.w / 2) / TILE), y) === 1) { p.y = y * TILE - p.h - 2; break; } }
    for (const e of this.ents) if (e.kind === "ebullet") e.dead = true;
    this.setState(this.camLock != null ? "boss" : "play");
  }

  stepBoss(e: Ent, dt: number, dx: number) {
    const p = this.player;
    if (e.state === "sleep") return;
    if (e.hp <= 0) { e.state = "dead"; if (e.t > 2) e.dead = true; return; }
    e.data.hurt = Math.max(0, (e.data.hurt || 0) - dt);
    if (e.state === "enter") { e.state = "walk"; e.t = 0; e.data.pat = 0; }
    e.dir = dx < 0 ? -1 : 1;
    const d = this.board.difficulty;
    if (e.state === "walk") {
      e.vx = e.dir * (28 + d * 6); if (Math.abs(dx) < 70) e.vx = -e.dir * 20;
      e.vy = Math.min(420, e.vy + GRAV * dt); this.move(e, dt, false);
      if (e.t > 1.6 + Math.random()) { e.state = Math.random() < 0.6 ? "fire" : "leap"; e.t = 0; }
    } else if (e.state === "fire") {
      e.vx = 0; e.vy = Math.min(420, e.vy + GRAV * dt); this.move(e, dt, false);
      const shots = 3 + d; const gap = 0.28;
      const k = Math.floor(e.t / gap);
      if (k < shots && e.data.lastShot !== k) {
        e.data.lastShot = k; e.data.flash = 0.15;
        const a = Math.atan2(p.y + 12 - (e.y + 20), p.x + 6 - (e.x + (e.dir > 0 ? e.w : 0))) + (Math.random() - 0.5) * 0.25;
        const b = this.mk("ebullet", e.x + (e.dir > 0 ? e.w : -8), e.y + 18, 8, 8); b.vx = Math.cos(a) * (140 + d * 10); b.vy = Math.sin(a) * (140 + d * 10); b.data.life = 3.5; b.data.big = true; this.sfx("eshot");
      }
      if (e.t > shots * gap + 0.6) { e.state = "walk"; e.t = 0; e.data.lastShot = -1; }
    } else if (e.state === "leap") {
      if (e.t < 0.35) { e.vx = 0; }
      else if (!e.data.jumped) { e.data.jumped = true; e.vy = -300; e.vx = e.dir * 120; this.sfx("jump"); }
      e.vy = Math.min(420, e.vy + GRAV * dt); const wasAir = !e.ground; this.move(e, dt, false);
      if (e.data.jumped && wasAir && e.ground) { this.shake = 1.2; this.burst(e.x + e.w / 2, e.y + e.h, 14, "#c0a070", 120, 2); this.sfx("stomp"); e.state = "walk"; e.t = 0; e.data.jumped = false; e.vx = 0; }
    }
    if (e.data.flash > 0) e.data.flash -= dt;
    this.touch(e, 2);
  }
  onBossDown(e: Ent) {
    this.bounty += this.board.boss.bounty; this.shake = 2; this.flash = 1; this.hitStop = 0.25;
    for (let i = 0; i < 6; i++) setTimeout(() => this.burst(e.x + Math.random() * e.w, e.y + Math.random() * e.h, 10, i % 2 ? "#ffd070" : "#ff8040", 140, 3), i * 180);
    for (const o of this.ents) if (o.kind === "ebullet") o.dead = true;
    setTimeout(() => { this.setState("cleared", `${this.board.boss.name} DOWN · +${this.board.boss.bounty}`); this.sfx("win"); }, 900);
  }

  // ── render
  render() {
    const c = this.ctx; c.imageSmoothingEnabled = false;
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 6 : 0, sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 4 : 0;
    const cam = Math.floor(this.cam);
    // parallax
    for (let i = 0; i < 3; i++) {
      const s = this.bg[i]; if (!s.img.complete || !s.img.naturalWidth) { if (i === 0) { c.fillStyle = "#0a0810"; c.fillRect(0, 0, VW, VH); } continue; }
      const f = [0.15, 0.45, 0.8][i]; const off = -Math.floor((cam * f) % 480); const y = i === 2 ? VH - 64 - 32 + 8 : 0;
      c.drawImage(s.img, off, y); c.drawImage(s.img, off + 480, y);
    }
    c.save(); c.translate(Math.floor(-cam + sx), Math.floor(sy));
    // tiles
    const ts = this.tiles; const x0 = Math.floor(cam / TILE), x1 = Math.min(this.level.cols - 1, x0 + Math.ceil(VW / TILE) + 1);
    if (ts.img.complete && ts.img.naturalWidth) {
      for (let ty = 0; ty < ROWS; ty++) for (let tx = x0; tx <= x1; tx++) {
        const v = this.tile(tx, ty); if (!v) continue;
        let id = 1;
        if (v === 1) { const up = this.tile(tx, ty - 1); if (up !== 1) { const l = this.tile(tx - 1, ty), r = this.tile(tx + 1, ty); id = l !== 1 ? 4 : r !== 1 ? 5 : 0; } else { const l = this.tile(tx - 1, ty), r = this.tile(tx + 1, ty), dn = this.tile(tx, ty + 1); id = l !== 1 ? 6 : r !== 1 ? 7 : dn !== 1 && ty < ROWS - 1 ? 9 : 1; } }
        else if (v === 2) id = 2; else if (v === 3) id = 3; else if (v === 8) id = 8; else if (v === 10) id = 10;
        c.drawImage(ts.img, id * 16, 0, 16, 16, tx * TILE, ty * TILE, 16, 16);
      }
    }
    // entities (sorted so the player is on top)
    for (const e of this.ents) if (e !== this.player) this.drawEnt(e);
    this.drawPlayer();
    // particles
    for (const q of this.parts) { c.fillStyle = q.c; c.globalAlpha = Math.min(1, q.life * 2); c.fillRect(Math.floor(q.x), Math.floor(q.y), q.s, q.s); }
    c.globalAlpha = 1;
    c.restore();
    // vignette / flash
    if (this.flash > 0) { c.fillStyle = `rgba(255,60,60,${this.flash * 0.35})`; c.fillRect(0, 0, VW, VH); }
    if (this.state === "intro") { c.fillStyle = `rgba(0,0,0,${Math.max(0, 1 - this.stateT / 0.8)})`; c.fillRect(0, 0, VW, VH); }
  }

  frame(s: Sheet, i: number, x: number, y: number, flip: boolean, w = s.fw, h = s.fh) {
    if (!s.img.complete || !s.img.naturalWidth) return;
    const c = this.ctx; const sxx = (i % s.cols) * s.fw, syy = Math.floor(i / s.cols) * s.fh;
    if (flip) { c.save(); c.translate(Math.floor(x) + w, Math.floor(y)); c.scale(-1, 1); c.drawImage(s.img, sxx, syy, s.fw, s.fh, 0, 0, w, h); c.restore(); }
    else c.drawImage(s.img, sxx, syy, s.fw, s.fh, Math.floor(x), Math.floor(y), w, h);
  }
  drawPlayer() {
    const p = this.player; const s = this.hunter; if (this.invuln > 0 && Math.floor(this.t * 20) % 2) return;
    let f = 0;
    if (this.state === "dying") f = 16 + Math.min(2, Math.floor(p.t / 0.35));
    else if (p.data.crouch) f = p.data.muzzle > 0 ? 15 : 14;
    else if (!p.ground) f = p.data.aim === -45 ? 13 : p.data.aim === 90 ? 12 : p.data.aim === 45 ? 11 : 8;
    else if (p.data.aim === 90) f = 12; else if (p.data.aim === 45) f = 11;
    else if (p.vx !== 0) f = 2 + Math.floor((this.t * 12) % 6);
    else f = p.data.muzzle > 0 ? 9 : Math.floor(this.t * 2) % 2;
    if (p.data.muzzle > 0) p.data.muzzle -= 1 / 120;
    // 64×64 frames, feet 4px above the frame bottom, centred on the 14-wide hitbox
    this.frame(s, f, p.x + p.w / 2 - 32, p.y + p.h + 4 - 64, p.dir < 0);
  }
  drawEnt(e: Ent) {
    const c = this.ctx;
    switch (e.kind) {
      case "grunt": case "elite": {
        const s = sheets[e.kind]; let f = 0;
        if (e.state === "dead") f = 10 + Math.min(2, Math.floor(e.t / 0.3));
        else if (e.data.hurt > 0) f = 13; else if (e.data.flash > 0) f = 8; else if (e.vx !== 0) f = 2 + Math.floor((this.t * 10) % 6); else f = Math.floor(this.t * 2) % 2;
        this.frame(s, f, e.x + e.w / 2 - 32, e.y + e.h + 4 - 64, e.dir < 0); break;
      }
      case "wasp": { const s = sheets.wasp; const f = e.hp <= 0 ? 3 + Math.min(1, Math.floor(e.t / 0.3)) : e.data.hurt > 0 ? 2 : Math.floor(this.t * 16) % 2; this.frame(s, f, e.x - 5, e.y - 8, e.dir < 0); break; }
      case "turret": { const s = sheets.turret; const f = e.state === "dead" ? 3 : e.data.flash > 0.1 ? 2 : Math.floor(this.t * 3) % 2; this.frame(s, f, e.x - 3, e.y - 4, e.dir < 0); break; }
      case "boss": { const s = this.bossSheet; const f = e.hp <= 0 ? 4 + Math.min(1, Math.floor(e.t / 0.6)) : e.data.hurt > 0 ? 3 : e.data.flash > 0 ? 2 : Math.floor(this.t * 3) % 2; this.frame(s, f, e.x - 6, e.y + e.h - 62, e.dir < 0); break; }
      case "crate": this.frame(this.items, 14, e.x, e.y, false); break;
      case "item": { const bob = Math.sin(this.t * 6) * 1.5; this.frame(this.items, e.data.item === 0 ? 0 : e.data.item === 5 ? 5 : e.data.item, e.x - 2, e.y - 2 + bob, false); break; }
      case "bullet": {
        if (e.data.laser) { c.save(); c.translate(e.x + 3, e.y + 3); c.rotate(Math.atan2(e.vy, e.vx)); this.frame(this.items, 8, -8, -8, false); c.restore(); }
        else if (e.data.flame) this.frame(this.items, 9, e.x - 5, e.y - 5, false);
        else { c.save(); c.translate(e.x + 3, e.y + 3); c.rotate(Math.atan2(e.vy, e.vx)); this.frame(this.items, 6, -8, -8, false); c.restore(); }
        break;
      }
      case "ebullet": { const sc = e.data.big ? 1.5 : 1; this.frame(this.items, 7, e.x + 3 - 8 * sc, e.y + 3 - 8 * sc, false, 16 * sc, 16 * sc); break; }
    }
  }
}

export function boardByN(n: number) { return BOARDS.find((b) => b.n === n) || BOARDS[0]; }
