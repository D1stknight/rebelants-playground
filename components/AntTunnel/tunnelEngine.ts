// components/AntTunnel/tunnelEngine.ts
// Ant Tunnel v2 — canvas engine. Same rules as the original DOM board (22×14 grid, crumbs 1 / sugar 5 / crystal 20,
// spider hit −3 s, wall breaks, clear all crystals to win early) but with smooth Pac-Man-style movement, a camera that can
// follow the ant on phones, and one draw call per frame instead of 300 animated divs.

export const ROWS = 14, COLS = 22, CELL = 32;
export type Cell = { row: number; col: number };
export type Dir = "up" | "down" | "left" | "right";
export type Theme = { bg: string; floor: string; wall: string; accent: string; crumb: string; sugar: string; crystal: string; antGlow: string; spiderGlow: string; neon?: boolean; dark?: boolean };
export type Cfg = { runSeconds: number; crystals: number; sugars: number; crumbs: number; wallBreaks: number; spiderSpeedMs: number };
export type Hud = { score: number; timeLeft: number; breaks: number; crystalsLeft: number; crystalsTotal: number; msg: string | null; state: "idle" | "play" | "won" | "lost"; hit: boolean };
export type EndResult = { score: number; fullClear: boolean; crystalsCollected: number; crystalsTotal: number; clearMs: number | null; crumbs: number; sugars: number };
export type Callbacks = { onHud: (h: Hud) => void; onEnd: (r: EndResult) => void; onSfx: (n: "crumb" | "sugar" | "crystal" | "wall" | "hit" | "win" | "lose" | "nowall") => void };
export type Sprites = { idle: HTMLImageElement; run: HTMLImageElement; left: HTMLImageElement; right: HTMLImageElement; hit: HTMLImageElement; win: HTMLImageElement; death: HTMLImageElement; spider: HTMLImageElement };

const DIRV: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const START: Cell = { row: 2, col: 2 }; const SPIDER_START: Cell = { row: 1, col: 10 };
const ANT_SPEED = 4.6;          // cells / s
const SPIDER_BASE = 3.1;        // cells / s at 160 ms config; scales with tunnelSpiderSpeedMs

type Mover = { x: number; y: number; dir: Dir | null; want: Dir | null; speed: number };
type Pick = { row: number; col: number; kind: 0 | 1 | 2; taken: boolean; ph: number };  // 0 crumb 1 sugar 2 crystal
type Part = { x: number; y: number; vx: number; vy: number; life: number; c: string; s: number };

export function loadSprites(faction = "samurai"): Sprites {
  const mk = (n: string) => { const i = new Image(); i.src = `/tunnel/${faction}/${n}.png`; return i; };
  const spider = new Image(); spider.src = "/spiders/spider.png";
  return { idle: mk("idle"), run: mk("run"), left: mk("left"), right: mk("right"), hit: mk("hit"), win: mk("win"), death: mk("death"), spider };
}

export class Tunnel {
  ctx: CanvasRenderingContext2D; layout: Set<string>; broken = new Set<string>(); theme: Theme; cfg: Cfg; cb: Callbacks; sp: Sprites;
  ant: Mover; spider: Mover; facing: Dir = "right"; picks: Pick[] = []; parts: Part[] = [];
  score = 0; crumbsGot = 0; sugarsGot = 0; crystalsGot = 0; crystalsTotal = 0; breaks: number; timeLeft: number; t = 0; state: Hud["state"] = "idle";
  msg: string | null = null; msgT = 0; hitT = 0; invuln = 0; shake = 0; flash = 0; startedAt = 0; raf = 0; last = 0; acc = 0; over = false; hudT = 0;
  input: Record<Dir, boolean> & { break: boolean } = { up: false, down: false, left: false, right: false, break: false }; breakLatch = false;
  // view
  vw = COLS * CELL; vh = ROWS * CELL; follow = false; camX = 0; camY = 0; zoom = 1; floorTex: HTMLCanvasElement | null = null; wallTex: HTMLCanvasElement | null = null;
  seedR = Math.random() * 1000;

  constructor(canvas: HTMLCanvasElement, layout: string[], theme: Theme, cfg: Cfg, cb: Callbacks, sprites: Sprites) {
    this.ctx = canvas.getContext("2d")!; this.layout = new Set(layout); this.theme = theme; this.cfg = cfg; this.cb = cb; this.sp = sprites;
    this.breaks = cfg.wallBreaks; this.timeLeft = cfg.runSeconds;
    this.ant = { x: START.col + 0.5, y: START.row + 0.5, dir: null, want: null, speed: ANT_SPEED };
    this.spider = { x: SPIDER_START.col + 0.5, y: SPIDER_START.row + 0.5, dir: null, want: null, speed: SPIDER_BASE * (160 / Math.max(60, cfg.spiderSpeedMs)) };
    this.bakeTextures(); this.placePickups(); this.pushHud();
  }

  // ── grid helpers
  isBorder(r: number, c: number) { return r <= 0 || c <= 0 || r >= ROWS - 1 || c >= COLS - 1; }
  isWall(r: number, c: number) { if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return true; if (this.isBorder(r, c)) return true; const k = `${r}:${c}`; return this.layout.has(k) && !this.broken.has(k); }
  breakable(r: number, c: number) { if (this.isBorder(r, c)) return false; const k = `${r}:${c}`; return this.layout.has(k) && !this.broken.has(k); }
  placePickups() {
    const open: Cell[] = []; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (!this.isWall(r, c) && !(r === START.row && c === START.col) && !(r === SPIDER_START.row && c === SPIDER_START.col)) open.push({ row: r, col: c });
    for (let i = open.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [open[i], open[j]] = [open[j], open[i]]; }
    const take = (n: number, kind: 0 | 1 | 2) => { for (let i = 0; i < n && open.length; i++) { const c = open.pop()!; this.picks.push({ row: c.row, col: c.col, kind, taken: false, ph: Math.random() * 6 }); } };
    take(this.cfg.crumbs, 0); take(this.cfg.sugars, 1); take(this.cfg.crystals, 2);
    this.crystalsTotal = this.picks.filter((p) => p.kind === 2).length;
  }

  // ── lifecycle
  play() { if (this.state === "play") return; this.state = "play"; this.startedAt = performance.now(); this.timeLeft = this.cfg.runSeconds; this.msg = null; this.pushHud(); }
  start() {
    this.last = performance.now();
    const loop = (now: number) => {
      if (this.over) return;
      const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.acc += dt;
      try { let n = 0; while (this.acc >= 1 / 120 && n++ < 8) { this.step(1 / 120); this.acc -= 1 / 120; } if (n >= 8) this.acc = 0; this.render(); } catch (e) { console.error("Tunnel frame error", e); this.acc = 0; }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { this.over = true; cancelAnimationFrame(this.raf); }
  setView(w: number, h: number, follow: boolean) { this.vw = Math.max(64, Math.round(w)); this.vh = Math.max(64, Math.round(h)); this.follow = follow; const cv = this.ctx.canvas; if (cv.width !== this.vw || cv.height !== this.vh) { cv.width = this.vw; cv.height = this.vh; } this.ctx.imageSmoothingEnabled = true; }
  say(m: string, t = 1.6) { this.msg = m; this.msgT = t; this.pushHud(); }
  pushHud() { this.cb.onHud({ score: this.score, timeLeft: Math.ceil(this.timeLeft), breaks: this.breaks, crystalsLeft: this.crystalsTotal - this.crystalsGot, crystalsTotal: this.crystalsTotal, msg: this.msg, state: this.state, hit: this.hitT > 0 }); }

  // ── simulation
  step(dt: number) {
    this.t += dt; if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) { this.msg = null; this.pushHud(); } }
    if (this.hitT > 0) this.hitT -= dt; if (this.invuln > 0) this.invuln -= dt; if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 4); if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 4);
    for (const q of this.parts) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 3 * dt; } this.parts = this.parts.filter((q) => q.life > 0);
    if (this.state !== "play") return;
    // timer
    const prev = Math.ceil(this.timeLeft); this.timeLeft -= dt; if (Math.ceil(this.timeLeft) !== prev) this.pushHud();
    if (this.timeLeft <= 0) { this.timeLeft = 0; this.end(false); return; }
    // input → wanted direction (last pressed wins)
    const want = (["up", "down", "left", "right"] as Dir[]).find((d) => this.input[d]) || null;
    if (want) { this.ant.want = want; this.facing = want; }
    if (this.input.break && !this.breakLatch) { this.breakLatch = true; this.doBreak(); } else if (!this.input.break) this.breakLatch = false;
    this.moveMover(this.ant, dt, true);
    // spider AI + move
    this.spiderThink(); this.moveMover(this.spider, dt, false);
    // pickups
    const ar = Math.floor(this.ant.y), ac = Math.floor(this.ant.x);
    for (const p of this.picks) {
      if (p.taken) continue; if (Math.abs(p.col + 0.5 - this.ant.x) < 0.45 && Math.abs(p.row + 0.5 - this.ant.y) < 0.45) {
        p.taken = true; const val = p.kind === 0 ? 1 : p.kind === 1 ? 5 : 20; this.score += val;
        if (p.kind === 0) this.crumbsGot++; else if (p.kind === 1) this.sugarsGot++; else this.crystalsGot++;
        this.cb.onSfx(p.kind === 0 ? "crumb" : p.kind === 1 ? "sugar" : "crystal");
        this.burst(p.col + 0.5, p.row + 0.5, p.kind === 0 ? this.theme.crumb : p.kind === 1 ? this.theme.sugar : this.theme.crystal, p.kind === 2 ? 16 : 7);
        this.pushHud();
        if (p.kind === 2 && this.crystalsGot >= this.crystalsTotal) { this.end(true); return; }
      }
    }
    void ar; void ac;
    // spider hit
    if (this.invuln <= 0 && Math.hypot(this.spider.x - this.ant.x, this.spider.y - this.ant.y) < 0.62) {
      this.invuln = 0.9; this.hitT = 0.35; this.flash = 1; this.shake = 1; this.timeLeft = Math.max(0, this.timeLeft - 3); this.cb.onSfx("hit"); this.say("Spider hit! −3 seconds", 1.2); this.burst(this.ant.x, this.ant.y, "#ff5566", 12);
    }
  }
  /** grid-locked smooth movement: turn at cell centres (with a little pre-turn slack), stop at walls */
  moveMover(m: Mover, dt: number, isAnt: boolean) {
    const cx = Math.floor(m.x) + 0.5, cy = Math.floor(m.y) + 0.5; const r = Math.floor(m.y), c = Math.floor(m.x);
    const near = Math.abs(m.x - cx) < 0.12 && Math.abs(m.y - cy) < 0.12;
    const open = (d: Dir) => { const [dx, dy] = DIRV[d]; return !this.isWall(r + dy, c + dx); };
    if (m.want && m.want !== m.dir) {
      const reverse = m.dir && DIRV[m.want][0] === -DIRV[m.dir][0] && DIRV[m.want][1] === -DIRV[m.dir][1];
      if (reverse) { m.dir = m.want; if (isAnt) m.want = null; }
      else if (near && open(m.want)) { m.x = cx; m.y = cy; m.dir = m.want; if (isAnt) m.want = null; }
    }
    if (!m.dir) return;
    const [dx, dy] = DIRV[m.dir]; let step = m.speed * dt;
    // will we pass the centre of the current cell into a wall?
    const toCenter = dx !== 0 ? (cx - m.x) * dx : (cy - m.y) * dy;   // distance along dir to this cell's centre (negative = past it)
    if (toCenter >= 0 && step > toCenter && !open(m.dir)) { m.x = cx; m.y = cy; m.dir = null; return; }
    if (toCenter < 0 && !open(m.dir)) { m.x = cx; m.y = cy; m.dir = null; return; }
    m.x += dx * step; m.y += dy * step;
    if (isAnt && m.want && m.want !== m.dir) { /* keep trying at the next centre */ } else if (isAnt && !m.want && !this.input[m.dir]) { /* keep gliding like Pac-Man */ }
  }
  spiderThink() {
    const s = this.spider; const cx = Math.floor(s.x) + 0.5, cy = Math.floor(s.y) + 0.5;
    if (Math.abs(s.x - cx) > 0.1 || Math.abs(s.y - cy) > 0.1) return;   // decide only at centres
    if (s.want && s.want !== s.dir) return;
    const r = Math.floor(s.y), c = Math.floor(s.x); const ar = Math.floor(this.ant.y), ac = Math.floor(this.ant.x);
    const dist = Math.abs(ar - r) + Math.abs(ac - c);
    const cands = (["up", "down", "left", "right"] as Dir[]).filter((d) => { const [dx, dy] = DIRV[d]; return !this.isWall(r + dy, c + dx); });
    if (!cands.length) { s.dir = null; return; }
    // don't reverse unless dead end
    const back = s.dir ? (["up", "down", "left", "right"] as Dir[]).find((d) => DIRV[d][0] === -DIRV[s.dir!][0] && DIRV[d][1] === -DIRV[s.dir!][1]) : null;
    const fwd = cands.filter((d) => d !== back); const pool = fwd.length ? fwd : cands;
    const ranked = [...pool].sort((a, b) => { const da = Math.abs(ar - (r + DIRV[a][1])) + Math.abs(ac - (c + DIRV[a][0])); const db = Math.abs(ar - (r + DIRV[b][1])) + Math.abs(ac - (c + DIRV[b][0])); return da - db; });
    const roll = Math.random(); let pick = ranked[0]; if (roll > 0.86 && ranked[1]) pick = ranked[1]; if (roll > 0.96) pick = pool[(Math.random() * pool.length) | 0];
    s.want = pick;
    // lunge when close, ramp with time
    const base = SPIDER_BASE * (160 / Math.max(60, this.cfg.spiderSpeedMs)) * (1 + Math.min(0.35, (this.cfg.runSeconds - this.timeLeft) / this.cfg.runSeconds * 0.35));
    s.speed = dist <= 6 ? base * 1.35 : base;
  }
  doBreak() {
    if (this.breaks <= 0) { this.say("No wall breakers left."); this.cb.onSfx("nowall"); return; }
    const r = Math.floor(this.ant.y), c = Math.floor(this.ant.x); const [dx, dy] = DIRV[this.facing]; const tr = r + dy, tc = c + dx;
    if (!this.breakable(tr, tc)) { this.say("No breakable wall in front of you."); this.cb.onSfx("nowall"); return; }
    this.broken.add(`${tr}:${tc}`); this.breaks--; this.cb.onSfx("wall"); this.burst(tc + 0.5, tr + 0.5, "#c8a97a", 18); this.shake = 0.4; this.say("Wall broken ✅", 0.9);
  }
  burst(x: number, y: number, c: string, n: number) { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3; this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life: 0.35 + Math.random() * 0.35, c, s: 2 + Math.random() * 3 }); } }
  end(won: boolean) {
    if (this.state !== "play") return; this.state = won ? "won" : "lost"; this.ant.dir = null; this.ant.want = null; this.spider.dir = null;
    this.cb.onSfx(won ? "win" : "lose"); this.say(won ? "Crystal sweep! 👑" : "Time's up", 3);
    if (won) this.burst(this.ant.x, this.ant.y, this.theme.crystal, 40);
    const clearMs = won ? Math.max(0, performance.now() - this.startedAt) : null;
    setTimeout(() => { if (!this.over) this.cb.onEnd({ score: this.score, fullClear: won, crystalsCollected: this.crystalsGot, crystalsTotal: this.crystalsTotal, clearMs, crumbs: this.crumbsGot, sugars: this.sugarsGot }); }, 900);
  }

  // ── rendering
  bakeTextures() {
    const mk = (fill: (c: CanvasRenderingContext2D) => void) => { const cv = document.createElement("canvas"); cv.width = CELL; cv.height = CELL; const c = cv.getContext("2d")!; fill(c); return cv; };
    const th = this.theme; const rng = mulberry(7);
    this.floorTex = mk((c) => { c.fillStyle = cssColor(th.floor, "rgba(255,255,255,0.05)"); c.fillRect(0, 0, CELL, CELL); for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(255,255,255,${0.02 + rng() * 0.04})`; c.fillRect(rng() * CELL, rng() * CELL, 1 + rng() * 2, 1 + rng() * 2); } for (let i = 0; i < 8; i++) { c.fillStyle = `rgba(0,0,0,${0.1 + rng() * 0.15})`; c.fillRect(rng() * CELL, rng() * CELL, 2 + rng() * 3, 1 + rng() * 2); } });
    this.wallTex = mk((c) => {
      const base = wallBase(th); c.fillStyle = base; c.fillRect(0, 0, CELL, CELL);
      // stones
      for (let i = 0; i < 6; i++) { const x = rng() * CELL, y = rng() * CELL, w = 6 + rng() * 12, h = 5 + rng() * 9; c.fillStyle = shadeCss(base, 1.18); c.beginPath(); c.ellipse(x, y, w / 2, h / 2, rng() * 3, 0, Math.PI * 2); c.fill(); c.fillStyle = shadeCss(base, 0.75); c.beginPath(); c.ellipse(x + 1.5, y + 2, w / 2, h / 2, rng() * 3, 0, Math.PI * 2); c.fill(); c.fillStyle = shadeCss(base, 1.05); c.beginPath(); c.ellipse(x, y, w / 2 - 1, h / 2 - 1, 0, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = "rgba(255,255,255,0.10)"; c.fillRect(0, 0, CELL, 2); c.fillRect(0, 0, 2, CELL); c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(0, CELL - 3, CELL, 3); c.fillRect(CELL - 3, 0, 3, CELL);
    });
  }
  render() {
    const c = this.ctx; const W = this.vw, H = this.vh; const th = this.theme;
    // camera: whole board fitted, or follow the ant at a fixed zoom
    const boardW = COLS * CELL, boardH = ROWS * CELL;
    if (this.follow) {
      this.zoom = Math.max(1.2, Math.min(2.4, Math.min(W, H) / (8.5 * CELL))); const vwW = W / this.zoom, vwH = H / this.zoom;
      const tx = boardW <= vwW ? -(vwW - boardW) / 2 : clamp(this.ant.x * CELL - vwW / 2, 0, boardW - vwW);
      const ty = boardH <= vwH ? -(vwH - boardH) / 2 : clamp(this.ant.y * CELL - vwH / 2, 0, boardH - vwH);
      this.camX += (tx - this.camX) * 0.18; this.camY += (ty - this.camY) * 0.18;
    }
    else { this.zoom = Math.min(W / boardW, H / boardH); this.camX = -(W / this.zoom - boardW) / 2; this.camY = -(H / this.zoom - boardH) / 2; }
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 6 : 0, sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 4 : 0;
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = "#07070c"; c.fillRect(0, 0, W, H);
    c.setTransform(this.zoom, 0, 0, this.zoom, -this.camX * this.zoom + sx, -this.camY * this.zoom + sy);
    // floor + walls
    const r0 = Math.max(0, Math.floor(this.camY / CELL)), r1 = Math.min(ROWS - 1, Math.ceil((this.camY + H / this.zoom) / CELL)), c0 = Math.max(0, Math.floor(this.camX / CELL)), c1 = Math.min(COLS - 1, Math.ceil((this.camX + W / this.zoom) / CELL));
    for (let r = r0; r <= r1; r++) for (let col = c0; col <= c1; col++) {
      const x = col * CELL, y = r * CELL;
      if (this.isWall(r, col)) { c.drawImage(this.wallTex!, x, y); if (this.broken.size && !this.layout.has(`${r}:${col}`)) { /* border */ } }
      else { c.drawImage(this.floorTex!, x, y); if (this.broken.has(`${r}:${col}`)) { c.fillStyle = "rgba(0,0,0,0.25)"; c.fillRect(x + 4, y + 4, CELL - 8, CELL - 8); c.fillStyle = shadeCss(wallBase(th), 0.9); for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(x + 8 + k * 6, y + CELL - 6 - (k % 2) * 3, 2.5, 0, Math.PI * 2); c.fill(); } } }
    }
    // pickups
    for (const p of this.picks) {
      if (p.taken) continue; const x = (p.col + 0.5) * CELL, y = (p.row + 0.5) * CELL; const bob = Math.sin(this.t * 3 + p.ph) * 1.5;
      if (p.kind === 0) { c.fillStyle = th.crumb; c.beginPath(); c.arc(x, y + bob * 0.3, 3.2, 0, Math.PI * 2); c.fill(); c.fillStyle = "rgba(255,255,255,0.35)"; c.beginPath(); c.arc(x - 1, y - 1 + bob * 0.3, 1.2, 0, Math.PI * 2); c.fill(); }
      else if (p.kind === 1) { c.save(); c.translate(x, y + bob); c.rotate(Math.PI / 4); c.fillStyle = th.sugar; c.shadowColor = th.sugar; c.shadowBlur = 8; c.fillRect(-5, -5, 10, 10); c.shadowBlur = 0; c.fillStyle = "rgba(255,255,255,0.5)"; c.fillRect(-4, -4, 3, 3); c.restore(); }
      else { c.save(); c.translate(x, y + bob * 1.4); c.fillStyle = th.crystal; c.shadowColor = th.crystal; c.shadowBlur = 14; c.beginPath(); c.moveTo(0, -11); c.lineTo(8, -2); c.lineTo(0, 11); c.lineTo(-8, -2); c.closePath(); c.fill(); c.shadowBlur = 0; c.fillStyle = "rgba(255,255,255,0.55)"; c.beginPath(); c.moveTo(0, -11); c.lineTo(4, -3); c.lineTo(-3, -4); c.closePath(); c.fill(); c.restore(); }
    }
    // spider
    const sp = this.sp.spider; if (sp.complete && sp.naturalWidth) { const h = CELL * 2.2, w = h * (sp.naturalWidth / sp.naturalHeight); const bob = Math.sin(this.t * 9) * 1.5; c.save(); c.shadowColor = th.spiderGlow.startsWith("#") ? th.spiderGlow : "rgba(239,68,68,0.5)"; c.shadowBlur = 16; const flip = this.spider.dir === "left"; c.translate(this.spider.x * CELL, this.spider.y * CELL + bob); if (flip) c.scale(-1, 1); c.drawImage(sp, -w / 2, -h * 0.55, w, h); c.restore(); }
    // ant
    const moving = !!this.ant.dir; const img = this.state === "won" ? this.sp.win : this.state === "lost" ? this.sp.death : this.hitT > 0 ? this.sp.hit : !moving && this.state !== "play" ? this.sp.idle : this.facing === "left" ? this.sp.left : this.facing === "right" ? this.sp.right : moving ? this.sp.run : this.sp.idle;
    if (img.complete && img.naturalWidth) {
      const h = CELL * 2.1, w = h * (img.naturalWidth / img.naturalHeight); const bob = moving ? Math.abs(Math.sin(this.t * 14)) * 3 : Math.sin(this.t * 2) * 1;
      const blink = this.invuln > 0 && this.hitT <= 0 && Math.floor(this.t * 16) % 2 === 0;
      if (!blink) { c.save(); c.shadowColor = th.antGlow.startsWith("#") ? th.antGlow : "rgba(96,165,250,0.5)"; c.shadowBlur = 14; c.translate(this.ant.x * CELL, this.ant.y * CELL - bob); if (this.state === "lost") c.rotate(-0.4); c.drawImage(img, -w / 2, -h * 0.62, w, h); c.restore(); }
    }
    // particles
    for (const q of this.parts) { c.globalAlpha = Math.min(1, q.life * 3); c.fillStyle = q.c; c.fillRect(q.x * CELL - q.s / 2, q.y * CELL - q.s / 2, q.s, q.s); } c.globalAlpha = 1;
    // darkness themes: lantern around the ant
    if (th.dark) { c.setTransform(1, 0, 0, 1, 0, 0); const ax = (this.ant.x * CELL - this.camX) * this.zoom + sx, ay = (this.ant.y * CELL - this.camY) * this.zoom + sy; const g = c.createRadialGradient(ax, ay, CELL * 1.6 * this.zoom, ax, ay, CELL * 5.5 * this.zoom); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.88)"); c.fillStyle = g; c.fillRect(0, 0, W, H); }
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (this.flash > 0) { c.fillStyle = `rgba(255,60,60,${this.flash * 0.35})`; c.fillRect(0, 0, W, H); }
    if (this.state === "idle") { c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(0, 0, W, H); }
  }
}

function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
function mulberry(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function cssColor(v: string, fallback: string) { return v && !v.includes("gradient") ? v : fallback; }
/** themes keep CSS gradients for walls; pull a solid tone out of them */
function wallBase(th: Theme) { if (th.wall.startsWith("#")) return th.wall; const m = th.wall.match(/rgba?\(([^)]+)\)/); if (m) { const [r, g, b] = m[1].split(",").map((s) => parseFloat(s)); return `rgb(${r | 0},${g | 0},${b | 0})`; } return "#4a3526"; }
function shadeCss(col: string, k: number) { let r = 0, g = 0, b = 0; if (col.startsWith("#")) { const h = col.slice(1); const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16); r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255; } else { const m = col.match(/\d+/g); if (m) { r = +m[0]; g = +m[1]; b = +m[2]; } } return `rgb(${clamp(r * k, 0, 255) | 0},${clamp(g * k, 0, 255) | 0},${clamp(b * k, 0, 255) | 0})`; }
