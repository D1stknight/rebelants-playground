// components/AntTunnel/tunnelEngine.ts
// Ant Tunnel v2 — canvas engine. Same rules as the original DOM board (22×14 grid, crumbs 1 / sugar 5 / crystal 20,
// spider hit −3 s, wall breaks, clear all crystals to win early) but with smooth Pac-Man-style movement, a camera that can
// follow the ant on phones, and one draw call per frame instead of 300 animated divs.

export const ROWS = 14, COLS = 22, CELL = 32;
export type Cell = { row: number; col: number };
export type Dir = "up" | "down" | "left" | "right";
export type Theme = { name?: string; bg: string; floor: string; wall: string; accent: string; crumb: string; sugar: string; crystal: string; antGlow: string; spiderGlow: string; neon?: boolean; dark?: boolean };
export type Cfg = { runSeconds: number; crystals: number; sugars: number; crumbs: number; wallBreaks: number; spiderSpeedMs: number;
  /** hearts per run (0 = no hearts: a spider hit costs −3 s instead) */ lives?: number; /** floor power-ups on/off */ powerups?: boolean;
  /** banked points per floor cleared (× floor number) */ floorBonus?: number; /** seconds added back per floor cleared */ floorTimeBonus?: number;
  /** rocks per run — throwable once 3+ spiders are on the floor, each kills one spider */ rocks?: number;
  /** power-ups placed per floor (each kind) */ powFreeze?: number; powClaw?: number; powDecoy?: number; powRush?: number; /** hearts cap (max grows +1 per floor cleared) */ livesCap?: number;
  /** environment id (colony, neon, …) → THEME_MODS gameplay modifiers */ themeId?: string };
/** what each tunnel environment actually does to the run (the lobby's DIFFICULTY text describes these) */
export type ThemeMods = { spider?: number; dark?: boolean; breakCooldown?: number; relentless?: boolean; breaks?: number; wallHits?: number; timer?: number; lives?: number };
export const THEME_MODS: Record<string, ThemeMods> = {
  colony: {},
  neon:   { spider: 1.15 },
  mythic: { dark: true, breaks: -1 },
  lava:   { breakCooldown: 2.5 },
  ice:    { spider: 1.25, relentless: true },
  golden: { breaks: -2 },
  shadow: { dark: true },
  amber:  { wallHits: 3 },
  toxic:  { dark: true, spider: 1.2, timer: 1.25 },
  void:   { dark: true, spider: 1.35, breaks: -3, lives: -1 },
};
export type Hud = { score: number; timeLeft: number; breaks: number; lives: number; livesMax: number; rocks: number; rocksOn: boolean; crystalsLeft: number; crystalsTotal: number; msg: string | null; state: "idle" | "play" | "won" | "lost"; hit: boolean; floor: number; combo: number; mult: number };
export type EndResult = { score: number; fullClear: boolean; crystalsCollected: number; crystalsTotal: number; clearMs: number | null; crumbs: number; sugars: number; floors: number };
export type SpiderKind = "chaser" | "patroller" | "ambusher";
export type Callbacks = { onHud: (h: Hud) => void; onEnd: (r: EndResult) => void; onSfx: (n: "crumb" | "sugar" | "crystal" | "wall" | "crack" | "hit" | "win" | "lose" | "nowall" | "floor") => void };
/** one 192×192 sheet per faction (tools/tunnel-sprites): 0 idle · 1–6 run side (faces right) · 7–10 run back · 11–14 run front · 15 hit · 16 win · 17 death · 18 dig · 19 idle breathe */
export type Sprites = { sheet: HTMLImageElement; spider: HTMLImageElement };
export const SF = 192, SCOLS = 8;

const DIRV: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const START: Cell = { row: 2, col: 2 }; const SPIDER_START: Cell = { row: 1, col: 10 };
const ANT_SPEED = 4.6;          // cells / s
const SPIDER_BASE = 3.1;        // cells / s at 160 ms config; scales with tunnelSpiderSpeedMs

type Mover = { x: number; y: number; dir: Dir | null; want: Dir | null; speed: number };
type Spider = Mover & { kind: SpiderKind; camp: Cell | null; alert: number; tint: string; frozen: number };
type Pick = { row: number; col: number; kind: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; taken: boolean; ph: number };  // 0 crumb 1 sugar 2 crystal 3 dig claw 4 decoy 5 web freeze 6 sugar rush 7 heart (may sit inside a breakable wall — glowing tile)
export const POWER_NAMES: Record<number, string> = { 3: "DIG CLAW +2", 4: "PHEROMONE DECOY", 5: "WEB FREEZE", 6: "SUGAR RUSH" };
type Part = { x: number; y: number; vx: number; vy: number; life: number; c: string; s: number };

export function loadSprites(faction = "samurai"): Sprites {
  const sheet = new Image(); sheet.src = `/tunnel/sheets/${faction}.png`;
  const spider = new Image(); spider.src = "/spiders/spider.png";
  return { sheet, spider };
}

export class Tunnel {
  ctx: CanvasRenderingContext2D; layout: Set<string>; broken = new Set<string>(); theme: Theme; cfg: Cfg; cb: Callbacks; sp: Sprites;
  ant: Mover; spiders: Spider[] = []; facing: Dir = "right"; picks: Pick[] = []; parts: Part[] = [];
  floor = 1; layouts: string[][]; layoutIdx = 0; combo = 0; comboT = 0; mult = 1; rush = 0; decoy: { x: number; y: number; t: number } | null = null; firstClearMs: number | null = null; sweeps = 0;
  score = 0; crumbsGot = 0; sugarsGot = 0; crystalsGot = 0; crystalsTotal = 0; breaks: number; timeLeft: number; t = 0; state: Hud["state"] = "idle";
  msg: string | null = null; msgT = 0; hitT = 0; invuln = 0; shake = 0; flash = 0; startedAt = 0; raf = 0; last = 0; acc = 0; over = false; hudT = 0;
  input: Record<Dir, boolean> & { break: boolean; rock: boolean } = { up: false, down: false, left: false, right: false, break: false, rock: false }; breakLatch = false;
  // view
  vw = COLS * CELL; vh = ROWS * CELL; follow = false; camX = 0; camY = 0; zoom = 1; floorTex: HTMLCanvasElement | null = null; wallTex: HTMLCanvasElement | null = null;
  seedR = Math.random() * 1000; dustT = 0; digT = 0; runT = 0;
  themes: Record<string, Theme> | null = null; themeId: string; transT = 0; transLabel = "";
  mods: ThemeMods; lives = 0; livesMax = 0; breakCd = 0; wallHits = new Map<string, number>(); dead = false;
  rocks = 0; rockLatch = false; shots: { x: number; y: number; dir: Dir; life: number }[] = []; crystalsRun = 0;

  constructor(canvas: HTMLCanvasElement, layout: string[], theme: Theme, cfg: Cfg, cb: Callbacks, sprites: Sprites, layouts?: string[][], layoutIdx = 0, themes?: Record<string, Theme>) {
    this.ctx = canvas.getContext("2d")!; this.layout = new Set(layout); this.theme = theme; this.cfg = cfg; this.cb = cb; this.sp = sprites;
    this.layouts = layouts || [layout]; this.layoutIdx = layoutIdx;
    this.themeId = cfg.themeId || "colony"; this.themes = themes || null; this.mods = THEME_MODS[this.themeId] || {}; if (this.mods.dark) this.theme = { ...theme, dark: true };
    this.breaks = this.maxBreaks(); this.timeLeft = cfg.runSeconds;
    this.livesMax = Math.max(0, (cfg.lives ?? 0) > 0 ? (cfg.lives ?? 0) + (this.mods.lives || 0) : 0); if ((cfg.lives ?? 0) > 0) this.livesMax = Math.max(1, this.livesMax); this.lives = this.livesMax; this.rocks = Math.max(0, cfg.rocks ?? 3);
    this.ant = { x: START.col + 0.5, y: START.row + 0.5, dir: null, want: null, speed: ANT_SPEED };
    this.bakeTextures(); this.placePickups(); this.spawnSpiders(); this.pushHud();
  }
  spiderSpeed() { return SPIDER_BASE * (160 / Math.max(60, this.cfg.spiderSpeedMs)) * (1 + (this.floor - 1) * 0.08) * (this.mods.spider || 1); }
  /** wall-break charges for the current floor: admin value, minus the environment's penalty, minus one per floor cleared (never below 1) */
  maxBreaks() { return Math.max(1, this.cfg.wallBreaks + (this.mods.breaks || 0) - (this.floor - 1)); }
  /** floor 1: one chaser (the classic). floor 2 adds a patroller, floor 3 an ambusher, floor 4+ a second chaser */
  spawnSpiders() {
    this.spiders = [];
    const mk = (kind: SpiderKind, cell: Cell, tint: string): Spider => ({ x: cell.col + 0.5, y: cell.row + 0.5, dir: null, want: null, speed: this.spiderSpeed(), kind, camp: kind === "ambusher" ? cell : null, alert: 0, tint, frozen: 0 });
    const far = this.openCells().filter((c) => Math.abs(c.row - START.row) + Math.abs(c.col - START.col) > 10);
    const pick = () => far.length ? far.splice((Math.random() * far.length) | 0, 1)[0] : SPIDER_START;
    this.spiders.push(mk("chaser", this.isWall(SPIDER_START.row, SPIDER_START.col) ? pick() : SPIDER_START, ""));
    if (this.floor >= 2) this.spiders.push(mk("patroller", pick(), "hue-rotate(120deg)"));
    if (this.floor >= 3) { const cr = this.picks.filter((p) => p.kind === 2 && !p.taken); const c = cr.length ? cr[(Math.random() * cr.length) | 0] : pick(); this.spiders.push(mk("ambusher", { row: (c as any).row, col: (c as any).col }, "hue-rotate(-60deg) saturate(1.6)")); }
    if (this.floor >= 4) this.spiders.push(mk("chaser", pick(), "brightness(1.3)"));
  }
  openCells() { const open: Cell[] = []; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (!this.isWall(r, c) && !(r === START.row && c === START.col)) open.push({ row: r, col: c }); return open; }

  // ── grid helpers
  isBorder(r: number, c: number) { return r <= 0 || c <= 0 || r >= ROWS - 1 || c >= COLS - 1; }
  isWall(r: number, c: number) { if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return true; if (this.isBorder(r, c)) return true; const k = `${r}:${c}`; return this.layout.has(k) && !this.broken.has(k); }
  breakable(r: number, c: number) { if (this.isBorder(r, c)) return false; const k = `${r}:${c}`; return this.layout.has(k) && !this.broken.has(k); }
  placePickups() {
    const open: Cell[] = []; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (!this.isWall(r, c) && !(r === START.row && c === START.col) && !(r === SPIDER_START.row && c === SPIDER_START.col)) open.push({ row: r, col: c });
    for (let i = open.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [open[i], open[j]] = [open[j], open[i]]; }
    const take = (n: number, kind: 0 | 1 | 2) => { for (let i = 0; i < n && open.length; i++) { const c = open.pop()!; this.picks.push({ row: c.row, col: c.col, kind, taken: false, ph: Math.random() * 6 }); } };
    take(this.cfg.crumbs, 0); take(this.cfg.sugars, 1); take(this.cfg.crystals, 2);
    // 1–2 power-ups per floor (none on the very first floor's opening seconds — they're placed far from the start)
    // power-ups per floor from admin (freeze 2 · claw 1 · decoy 1 · rush 1 by default); the master toggle zeroes them all
    if (this.cfg.powerups !== false) {
      const counts: [3 | 4 | 5 | 6, number][] = [[5, this.cfg.powFreeze ?? 2], [3, this.cfg.powClaw ?? 1], [4, this.cfg.powDecoy ?? 1], [6, this.cfg.powRush ?? 1]];
      for (const [kind, n] of counts) for (let i = 0; i < n && open.length; i++) { const c = open.pop()!; this.picks.push({ row: c.row, col: c.col, kind, taken: false, ph: Math.random() * 6 }); }
    }
    this.crystalsTotal = this.picks.filter((p) => p.kind === 2).length;
    // one heart per floor (when hearts are on). Half the time it is buried in a breakable wall next to a corridor — the wall glows pink.
    if (this.livesMax > 0) {
      let placed = false;
      if (Math.random() < 0.5) {
        const walls: Cell[] = []; for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) if (this.breakable(r, c) && !this.picks.some((q) => q.row === r && q.col === c) && Object.values(DIRV).some(([dx, dy]) => !this.isWall(r + dy, c + dx))) walls.push({ row: r, col: c });
        if (walls.length) { const w = walls[(Math.random() * walls.length) | 0]; this.picks.push({ row: w.row, col: w.col, kind: 7, taken: false, ph: Math.random() * 6 }); placed = true; }
      }
      if (!placed && open.length) { const c = open.pop()!; this.picks.push({ row: c.row, col: c.col, kind: 7, taken: false, ph: Math.random() * 6 }); }
    }
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
  rocksUnlocked = false;
  /** rocks unlock the first time a floor has 3 spiders and stay available for the rest of the run */
  rocksOn() { if (this.spiders.length >= 3) this.rocksUnlocked = true; return this.rocksUnlocked; }
  pushHud() { this.cb.onHud({ score: this.score, timeLeft: Math.ceil(this.timeLeft), breaks: this.breaks, lives: this.lives, livesMax: this.livesMax, rocks: this.rocks, rocksOn: this.rocksOn(), crystalsLeft: this.crystalsTotal - this.crystalsGot, crystalsTotal: this.crystalsTotal, msg: this.msg, state: this.state, hit: this.hitT > 0, floor: this.floor, combo: this.combo, mult: this.mult }); }

  // ── simulation
  step(dt: number) {
    this.t += dt; if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) { this.msg = null; this.pushHud(); } }
    if (this.hitT > 0) this.hitT -= dt; if (this.invuln > 0) this.invuln -= dt; if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 4); if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 4);
    for (const q of this.parts) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 3 * dt; } this.parts = this.parts.filter((q) => q.life > 0);
    if (this.state !== "play") return;
    if (this.transT > 0) { this.transT -= dt; if (this.transT <= 0) { this.transT = 0; this.say(`FLOOR ${this.floor} — GO!`, 1); } return; }   // floor countdown: everything frozen
    // timer
    if (this.breakCd > 0) this.breakCd -= dt;
    const prev = Math.ceil(this.timeLeft); this.timeLeft -= dt * (this.mods.timer || 1); if (Math.ceil(this.timeLeft) !== prev) this.pushHud();
    if (this.timeLeft <= 0) { this.timeLeft = 0; this.end(false); return; }
    // input → wanted direction (last pressed wins)
    const want = (["up", "down", "left", "right"] as Dir[]).find((d) => this.input[d]) || null;
    if (want) { this.ant.want = want; this.facing = want; }
    if (this.input.break && !this.breakLatch) { this.breakLatch = true; this.doBreak(); } else if (!this.input.break) this.breakLatch = false;
    if (this.input.rock && !this.rockLatch) { this.rockLatch = true; this.throwRock(); } else if (!this.input.rock) this.rockLatch = false;
    // rocks in flight: straight down the corridor, stop at walls, kill the first spider they touch
    for (const sh of this.shots) { const [dx, dy] = DIRV[sh.dir]; const step = 13 * dt; const nx = sh.x + dx * step, ny = sh.y + dy * step; sh.life -= dt;
      if (this.isWall(Math.floor(ny), Math.floor(nx))) { sh.life = 0; this.burst(sh.x, sh.y, "#b8a48a", 8); continue; } sh.x = nx; sh.y = ny;
      const k = this.spiders.findIndex((q) => Math.hypot(q.x - sh.x, q.y - sh.y) < 0.6);
      if (k >= 0) { const q = this.spiders.splice(k, 1)[0]; sh.life = 0; this.burst(q.x, q.y, "#ff5566", 26); this.score += 30; this.cb.onSfx("crystal"); this.say("🪨 Spider squashed! +30", 1.5); this.pushHud(); } }
    this.shots = this.shots.filter((q) => q.life > 0);
    const wasMoving = !!this.ant.dir; this.moveMover(this.ant, dt, true);
    if (this.ant.dir) { this.runT += dt; this.dustT -= dt; if (this.dustT <= 0) { this.dustT = 0.11; const [dx, dy] = DIRV[this.ant.dir]; this.parts.push({ x: this.ant.x - dx * 0.35 + (Math.random() - 0.5) * 0.2, y: this.ant.y + 0.28 - dy * 0.3, vx: -dx * 0.8 + (Math.random() - 0.5) * 0.6, vy: -0.6 - Math.random() * 0.6, life: 0.3 + Math.random() * 0.2, c: "rgba(200,180,150,0.55)", s: 3 + Math.random() * 3 }); } } else if (wasMoving) this.runT = 0;
    if (this.digT > 0) this.digT -= dt;
    if (this.rush > 0) { this.rush -= dt; this.ant.speed = ANT_SPEED * 1.45; if (this.rush <= 0) this.ant.speed = ANT_SPEED; }
    if (this.decoy) { this.decoy.t -= dt; if (this.decoy.t <= 0) this.decoy = null; }
    if (this.combo > 0) { this.comboT -= dt; if (this.comboT <= 0) { this.combo = 0; this.mult = 1; this.pushHud(); } }
    // spiders
    for (const sp of this.spiders) { if (sp.frozen > 0) { sp.frozen -= dt; continue; } this.spiderThink(sp); this.moveMover(sp, dt, false); }
    // pickups
    const ar = Math.floor(this.ant.y), ac = Math.floor(this.ant.x);
    for (const p of this.picks) {
      if (p.taken) continue; if (Math.abs(p.col + 0.5 - this.ant.x) < 0.45 && Math.abs(p.row + 0.5 - this.ant.y) < 0.45) {
        p.taken = true;
        if (p.kind === 7) { this.cb.onSfx("crystal"); this.burst(p.col + 0.5, p.row + 0.5, "#ff5b8a", 22); if (this.lives < this.livesMax) { this.lives++; this.say(`❤ HEART +1  ${"❤".repeat(this.lives)}`, 1.4); } else { this.score += 15; this.say("❤ Full hearts — +15", 1.2); } this.pushHud(); continue; }
        if (p.kind >= 3) { this.powerUp(p.kind); this.burst(p.col + 0.5, p.row + 0.5, "#ffffff", 14); continue; }
        // combo: keep picking things up within 1.6 s → ×2 after 8, ×3 after 18
        this.combo++; this.comboT = 1.6; this.mult = this.combo >= 18 ? 3 : this.combo >= 8 ? 2 : 1;
        const val = (p.kind === 0 ? 1 : p.kind === 1 ? 5 : 20) * this.mult; this.score += val;
        if (p.kind === 0) this.crumbsGot++; else if (p.kind === 1) this.sugarsGot++; else { this.crystalsGot++; this.crystalsRun++; }
        this.cb.onSfx(p.kind === 0 ? "crumb" : p.kind === 1 ? "sugar" : "crystal");
        this.burst(p.col + 0.5, p.row + 0.5, p.kind === 0 ? this.theme.crumb : p.kind === 1 ? this.theme.sugar : this.theme.crystal, p.kind === 2 ? 16 : 7);
        if (this.combo === 8 || this.combo === 18) this.say(`COMBO ×${this.mult}`, 1.1);
        this.pushHud();
        if (p.kind === 2 && this.crystalsGot >= this.crystalsTotal) { this.sweep(); return; }
      }
    }
    void ar; void ac;
    // spider hit
    if (this.invuln <= 0 && this.spiders.some((sp) => Math.hypot(sp.x - this.ant.x, sp.y - this.ant.y) < 0.62)) {
      this.invuln = 0.9; this.combo = 0; this.mult = 1; this.hitT = 0.35; this.flash = 1; this.shake = 1; this.cb.onSfx("hit"); this.burst(this.ant.x, this.ant.y, "#ff5566", 12);
      if (this.livesMax > 0) { this.lives--; if (this.lives <= 0) { this.lives = 0; this.dead = true; this.pushHud(); this.end(false); return; } this.say(`Spider hit! ${"❤".repeat(this.lives)} left`, 1.2); this.invuln = 1.4; }
      else { this.timeLeft = Math.max(0, this.timeLeft - 3); this.say("Spider hit! −3 seconds", 1.2); }
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
  spiderThink(s: Spider) {
    const cx = Math.floor(s.x) + 0.5, cy = Math.floor(s.y) + 0.5;
    if (Math.abs(s.x - cx) > 0.1 || Math.abs(s.y - cy) > 0.1) return;   // decide only at centres
    if (s.want && s.want !== s.dir) return;
    const r = Math.floor(s.y), c = Math.floor(s.x);
    // target: the decoy if one is live, else the ant (chaser / alerted ambusher) or the camp (ambusher going home)
    let tr = Math.floor(this.ant.y), tc = Math.floor(this.ant.x);
    if (this.decoy) { tr = Math.floor(this.decoy.y); tc = Math.floor(this.decoy.x); }
    const distAnt = Math.abs(Math.floor(this.ant.y) - r) + Math.abs(Math.floor(this.ant.x) - c);
    if (s.kind === "ambusher") { if (distAnt <= 5 && !this.decoy) s.alert = 3; else if (s.alert > 0) s.alert -= 1 / 8; if (s.alert <= 0 && s.camp) { tr = s.camp.row; tc = s.camp.col; if (r === tr && c === tc) { s.dir = null; return; } } }
    const cands = (["up", "down", "left", "right"] as Dir[]).filter((d) => { const [dx, dy] = DIRV[d]; return !this.isWall(r + dy, c + dx); });
    if (!cands.length) { s.dir = null; return; }
    const back = s.dir ? (["up", "down", "left", "right"] as Dir[]).find((d) => DIRV[d][0] === -DIRV[s.dir!][0] && DIRV[d][1] === -DIRV[s.dir!][1]) : null;
    const fwd = cands.filter((d) => d !== back); const pool = fwd.length ? fwd : cands;
    let pick: Dir;
    if (s.kind === "patroller") { pick = s.dir && pool.includes(s.dir) && Math.random() < 0.6 ? s.dir : pool[(Math.random() * pool.length) | 0]; }   // wanders a fixed-feeling loop, never hunts
    else {
      const ranked = [...pool].sort((a, b) => { const da = Math.abs(tr - (r + DIRV[a][1])) + Math.abs(tc - (c + DIRV[a][0])); const db = Math.abs(tr - (r + DIRV[b][1])) + Math.abs(tc - (c + DIRV[b][0])); return da - db; });
      const roll = this.mods.relentless ? 0 : Math.random(); pick = ranked[0]; if (roll > 0.86 && ranked[1]) pick = ranked[1]; if (roll > 0.96) pick = pool[(Math.random() * pool.length) | 0];
    }
    s.want = pick;
    const base = this.spiderSpeed() * (1 + Math.min(0.35, ((this.cfg.runSeconds - this.timeLeft) / this.cfg.runSeconds) * 0.35));
    s.speed = s.kind === "patroller" ? base * 0.9 : s.kind === "ambusher" ? (s.alert > 0 ? base * 1.6 : base * 0.7) : distAnt <= 6 ? base * 1.35 : base;
  }
  powerUp(kind: number) {
    this.cb.onSfx("sugar");
    if (kind === 3) { this.breaks += 2; this.say("⛏ DIG CLAW +2 breaks", 1.4); }
    else if (kind === 4) { this.decoy = { x: this.ant.x, y: this.ant.y, t: 4.5 }; this.say("🧪 PHEROMONE DECOY — spiders chase the scent", 1.6); }
    else if (kind === 5) { for (const sp of this.spiders) sp.frozen = 3.2; this.say("❄ WEB FREEZE — spiders stuck 3 s", 1.4); }
    else if (kind === 6) { this.rush = 4.5; this.say("⚡ SUGAR RUSH", 1.2); }
    this.pushHud();
  }
  /** all crystals collected: bank a floor bonus and drop into the next layout with more spiders and fewer breaks */
  sweep() {
    this.sweeps++; if (this.firstClearMs == null) this.firstClearMs = Math.max(0, performance.now() - this.startedAt);
    const bonus = (this.cfg.floorBonus ?? 25) * this.floor + Math.ceil(this.timeLeft); this.score += bonus; this.cb.onSfx("floor");
    this.burst(this.ant.x, this.ant.y, this.theme.crystal, 40); this.say(`FLOOR ${this.floor} CLEARED  +${bonus}`, 2.2);
    this.floor++; this.timeLeft = Math.min(this.cfg.runSeconds, this.timeLeft + (this.cfg.floorTimeBonus ?? 20)); this.breaks = Math.max(1, Math.min(this.breaks, this.maxBreaks())); if (this.livesMax > 0) { this.livesMax = Math.min(this.cfg.livesCap ?? 10, this.livesMax + 1); this.lives = Math.min(this.livesMax, this.lives + 2); } this.wallHits.clear(); this.breakCd = 0;
    // next layout (never the same one twice in a row)
    if (this.layouts.length > 1) { let n = this.layoutIdx; while (n === this.layoutIdx) n = (Math.random() * this.layouts.length) | 0; this.layoutIdx = n; this.layout = new Set(this.layouts[n]); }
    // new environment (never the same twice): swap textures + gameplay modifiers, then a 3 s countdown before the floor starts
    if (this.themes) { const keys = Object.keys(this.themes).filter((k) => k !== this.themeId && THEME_MODS[k]); if (keys.length) { const k = keys[(Math.random() * keys.length) | 0]; this.themeId = k; this.mods = THEME_MODS[k] || {}; this.theme = { ...this.themes[k], dark: !!this.mods.dark }; this.bakeTextures(); this.breaks = Math.max(1, Math.min(this.breaks, this.maxBreaks())); } }
    this.transT = 3.2; this.transLabel = this.theme.name || this.themeId;
    this.broken.clear(); this.picks = []; this.crystalsGot = 0; this.shots = []; this.placePickups(); this.spawnSpiders();
    this.ant.x = START.col + 0.5; this.ant.y = START.row + 0.5; this.ant.dir = null; this.ant.want = null; this.facing = "right"; this.invuln = 1.5; this.decoy = null; this.combo = 0; this.mult = 1;
    this.pushHud();
  }
  throwRock() {
    if (!this.rocksOn()) { this.say("🪨 Rocks unlock when 3 spiders are on the floor", 1.2); this.cb.onSfx("nowall"); return; }
    if (this.rocks <= 0) { this.say("No rocks left.", 1); this.cb.onSfx("nowall"); return; }
    this.rocks--; this.shots.push({ x: this.ant.x, y: this.ant.y, dir: this.facing, life: 1.2 }); this.digT = 0.3; this.cb.onSfx("wall"); this.pushHud();
  }
  doBreak() {
    if (this.breaks <= 0) { this.say("No wall breakers left."); this.cb.onSfx("nowall"); return; }
    const r = Math.floor(this.ant.y), c = Math.floor(this.ant.x); const [dx, dy] = DIRV[this.facing]; const tr = r + dy, tc = c + dx;
    if (!this.breakable(tr, tc)) { this.say("No breakable wall in front of you."); this.cb.onSfx("nowall"); return; }
    if (this.breakCd > 0) { this.say(`🌋 Too hot — pick cools in ${this.breakCd.toFixed(1)} s`, 0.8); this.cb.onSfx("nowall"); return; }
    const k = `${tr}:${tc}`; const need = this.mods.wallHits || 2; const hits = (this.wallHits.get(k) || 0) + 1; this.digT = 0.35; this.breakCd = this.mods.breakCooldown || 0;
    if (hits < need) { this.wallHits.set(k, hits); this.cb.onSfx("crack"); this.burst(tc + 0.5, tr + 0.5, "#c8a97a", 10); this.shake = 0.3; this.say(need - hits > 1 ? `Cracked! ${need - hits} more hits` : "Cracked! One more hit breaks it (no charge used)", 0.9); return; }
    this.broken.add(k); this.wallHits.delete(k); this.breaks--; if (this.picks.some((p) => p.kind === 7 && !p.taken && p.row === tr && p.col === tc)) this.say("❤ A heart was buried here!", 1.4); this.cb.onSfx("wall"); this.burst(tc + 0.5, tr + 0.5, "#c8a97a", 18); this.shake = 0.4; this.say("Wall broken ✅", 0.9);
  }
  burst(x: number, y: number, c: string, n: number) { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3; this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life: 0.35 + Math.random() * 0.35, c, s: 2 + Math.random() * 3 }); } }
  end(won: boolean) {
    if (this.state !== "play") return; const swept = this.sweeps > 0; this.state = swept ? "won" : "lost"; this.ant.dir = null; this.ant.want = null; for (const sp of this.spiders) sp.dir = null;
    this.cb.onSfx(swept ? "win" : "lose"); const out = this.dead; this.say(out ? (swept ? `Caught — ${this.sweeps} floor${this.sweeps > 1 ? "s" : ""} cleared 👑` : "Caught by the spiders 🕷") : swept ? `Time's up — ${this.sweeps} floor${this.sweeps > 1 ? "s" : ""} cleared 👑` : "Time's up", 3); void won;
    setTimeout(() => { this.cb.onEnd({ score: this.score, fullClear: swept, crystalsCollected: this.crystalsRun, crystalsTotal: this.crystalsTotal, clearMs: this.firstClearMs, crumbs: this.crumbsGot, sugars: this.sugarsGot, floors: this.sweeps }); }, 900);
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
      if (this.isWall(r, col)) { c.drawImage(this.wallTex!, x, y); const wh = this.wallHits.size ? this.wallHits.get(`${r}:${col}`) || 0 : 0; if (wh > 0) { c.strokeStyle = "rgba(0,0,0,0.8)"; c.lineWidth = 2; c.beginPath(); c.moveTo(x + 6, y + 4); c.lineTo(x + 14, y + 15); c.lineTo(x + 10, y + 22); c.lineTo(x + 20, y + 29); c.moveTo(x + 14, y + 15); c.lineTo(x + 24, y + 12); if (wh > 1) { c.moveTo(x + 26, y + 3); c.lineTo(x + 20, y + 13); c.lineTo(x + 28, y + 20); c.moveTo(x + 3, y + 26); c.lineTo(x + 12, y + 24); } c.stroke(); c.strokeStyle = "rgba(255,255,255,0.25)"; c.lineWidth = 1; c.beginPath(); c.moveTo(x + 7, y + 5); c.lineTo(x + 15, y + 16); c.stroke(); } }
      else { c.drawImage(this.floorTex!, x, y); if (this.broken.has(`${r}:${col}`)) { c.fillStyle = "rgba(0,0,0,0.25)"; c.fillRect(x + 4, y + 4, CELL - 8, CELL - 8); c.fillStyle = shadeCss(wallBase(th), 0.9); for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(x + 8 + k * 6, y + CELL - 6 - (k % 2) * 3, 2.5, 0, Math.PI * 2); c.fill(); } } }
    }
    // pickups
    for (const p of this.picks) {
      if (p.taken || p.kind >= 3) continue; const x = (p.col + 0.5) * CELL, y = (p.row + 0.5) * CELL; const bob = Math.sin(this.t * 3 + p.ph) * 1.5;
      if (p.kind === 0) { c.fillStyle = th.crumb; c.beginPath(); c.arc(x, y + bob * 0.3, 3.2, 0, Math.PI * 2); c.fill(); c.fillStyle = "rgba(255,255,255,0.35)"; c.beginPath(); c.arc(x - 1, y - 1 + bob * 0.3, 1.2, 0, Math.PI * 2); c.fill(); }
      else if (p.kind === 1) { c.save(); c.translate(x, y + bob); c.rotate(Math.PI / 4); c.fillStyle = th.sugar; c.shadowColor = th.sugar; c.shadowBlur = 8; c.fillRect(-5, -5, 10, 10); c.shadowBlur = 0; c.fillStyle = "rgba(255,255,255,0.5)"; c.fillRect(-4, -4, 3, 3); c.restore(); }
      else { const pulse = 0.6 + 0.4 * Math.sin(this.t * 4 + p.ph); c.save(); c.translate(x, y + bob * 1.4); const gl = c.createRadialGradient(0, 0, 2, 0, 0, 22 + pulse * 6); gl.addColorStop(0, hexA(th.crystal, 0.55 * pulse + 0.2)); gl.addColorStop(1, hexA(th.crystal, 0)); c.fillStyle = gl; c.beginPath(); c.arc(0, 0, 28, 0, Math.PI * 2); c.fill(); c.fillStyle = th.crystal; c.shadowColor = th.crystal; c.shadowBlur = 18 + pulse * 10; c.beginPath(); c.moveTo(0, -11); c.lineTo(8, -2); c.lineTo(0, 11); c.lineTo(-8, -2); c.closePath(); c.fill(); c.shadowBlur = 0; c.fillStyle = "rgba(255,255,255,0.55)"; c.beginPath(); c.moveTo(0, -11); c.lineTo(4, -3); c.lineTo(-3, -4); c.closePath(); c.fill(); const sk = Math.max(0, Math.sin(this.t * 5 + p.ph * 2)); if (sk > 0.6) { c.fillStyle = `rgba(255,255,255,${(sk - 0.6) * 2.5})`; c.fillRect(-1, -19 + 4 * sk, 2, 8); c.fillRect(-4, -16 + 4 * sk, 8, 2); } c.restore(); }
    }
    // hearts: buried ones make the wall tile pulse pink (with a glint) until it is broken; free ones float like power-ups
    for (const p of this.picks) {
      if (p.taken || p.kind !== 7) continue; const x = (p.col + 0.5) * CELL, y = (p.row + 0.5) * CELL; const pulse = 0.5 + 0.5 * Math.sin(this.t * 4 + p.ph);
      if (this.isWall(p.row, p.col)) { c.save(); c.fillStyle = `rgba(255,80,140,${0.18 + pulse * 0.22})`; c.fillRect(p.col * CELL, p.row * CELL, CELL, CELL); const g4 = c.createRadialGradient(x, y, 1, x, y, 10 + pulse * 6); g4.addColorStop(0, `rgba(255,150,190,${0.5 + pulse * 0.4})`); g4.addColorStop(1, "rgba(255,80,140,0)"); c.fillStyle = g4; c.fillRect(p.col * CELL, p.row * CELL, CELL, CELL); c.font = "11px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.globalAlpha = 0.55 + pulse * 0.45; c.fillText("❤", x, y + 1); c.restore(); continue; }
      c.save(); c.translate(x, y + Math.sin(this.t * 3 + p.ph) * 2); const g5 = c.createRadialGradient(0, 0, 2, 0, 0, 16 + pulse * 8); g5.addColorStop(0, "rgba(255,90,150,0.55)"); g5.addColorStop(1, "rgba(255,90,150,0)"); c.fillStyle = g5; c.beginPath(); c.arc(0, 0, 24, 0, Math.PI * 2); c.fill();
      c.font = "18px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("❤️", 0, 1); c.restore();
    }
    // power-ups (emoji glyphs with a glow) + decoy marker
    for (const p of this.picks) {
      if (p.taken || p.kind < 3 || p.kind === 7) continue; const x = (p.col + 0.5) * CELL, y = (p.row + 0.5) * CELL; const pulse = 0.6 + 0.4 * Math.sin(this.t * 5 + p.ph);
      c.save(); c.translate(x, y + Math.sin(this.t * 3 + p.ph) * 2); const g2 = c.createRadialGradient(0, 0, 2, 0, 0, 16 + pulse * 6); g2.addColorStop(0, "rgba(255,255,255,0.35)"); g2.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g2; c.beginPath(); c.arc(0, 0, 22, 0, Math.PI * 2); c.fill();
      c.font = "18px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(p.kind === 3 ? "⛏" : p.kind === 4 ? "🧪" : p.kind === 5 ? "❄️" : "⚡", 0, 1); c.restore();
    }
    if (this.decoy) { c.save(); c.translate(this.decoy.x * CELL, this.decoy.y * CELL); const g3 = c.createRadialGradient(0, 0, 2, 0, 0, 14 + Math.sin(this.t * 6) * 3); g3.addColorStop(0, "rgba(255,120,220,0.7)"); g3.addColorStop(1, "rgba(255,120,220,0)"); c.fillStyle = g3; c.beginPath(); c.arc(0, 0, 18, 0, Math.PI * 2); c.fill(); c.restore(); }
    for (const sh of this.shots) { c.save(); c.translate(sh.x * CELL, sh.y * CELL); c.rotate(this.t * 20); c.fillStyle = "#9c8a6e"; c.beginPath(); c.moveTo(-6, -4); c.lineTo(3, -6); c.lineTo(7, 1); c.lineTo(2, 6); c.lineTo(-6, 3); c.closePath(); c.fill(); c.fillStyle = "rgba(255,255,255,0.35)"; c.fillRect(-3, -3, 3, 2); c.restore(); }
    // spiders
    const sp = this.sp.spider; if (sp.complete && sp.naturalWidth) for (const s of this.spiders) {
      const h = CELL * 1.5, w = h * (sp.naturalWidth / sp.naturalHeight); const bob = s.frozen > 0 ? 0 : Math.sin(this.t * 9 + s.x) * 1.5;
      c.save(); c.shadowColor = s.frozen > 0 ? "rgba(120,200,255,0.9)" : th.spiderGlow.startsWith("#") ? th.spiderGlow : "rgba(239,68,68,0.5)"; c.shadowBlur = 16; if (s.tint) c.filter = s.tint; if (s.frozen > 0) c.filter = (s.tint ? s.tint + " " : "") + "saturate(0.2) brightness(1.4)";
      c.translate(s.x * CELL, s.y * CELL + bob); if (s.dir === "left") c.scale(-1, 1); c.drawImage(sp, -w / 2, -h * 0.55, w, h); c.restore();
      if (s.kind === "ambusher" && s.alert > 0) { c.fillStyle = "#ff5566"; c.font = "bold 10px sans-serif"; c.textAlign = "center"; c.fillText("!", s.x * CELL, s.y * CELL - h * 0.6); }
    }
    // ant — sheet frame by state / facing, animated while moving
    const sh = this.sp.sheet;
    if (sh.complete && sh.naturalWidth) {
      const moving = !!this.ant.dir; let fi = 0; let flip = false;
      if (this.dead) fi = 17; else if (this.state === "won") fi = 16; else if (this.state === "lost") fi = 17; else if (this.hitT > 0) fi = 15; else if (this.digT > 0) { fi = 18; flip = this.facing === "left"; }
      else if (moving) { const f = this.facing; const k = Math.floor(this.runT * 11); if (f === "up") fi = 7 + (k % 4); else if (f === "down") fi = 11 + (k % 4); else { fi = 1 + (k % 6); flip = f === "left"; } }
      else fi = 0;   // one steady idle frame (alternating frames made the legs flicker)
      if (!moving && this.state === "play") flip = this.facing === "left";
      const h = CELL * 1.45, w = h; const bob = moving ? Math.abs(Math.sin(this.runT * Math.PI * 11 / 3)) * 1.0 : Math.sin(this.t * 2.2) * 0.6;
      const blink = this.invuln > 0 && this.hitT <= 0 && Math.floor(this.t * 16) % 2 === 0;
      if (!blink) { c.save(); c.translate(this.ant.x * CELL, this.ant.y * CELL - bob); if (flip) c.scale(-1, 1); c.shadowColor = th.antGlow.startsWith("#") ? th.antGlow : "rgba(96,165,250,0.5)"; c.shadowBlur = 12; c.drawImage(sh, (fi % SCOLS) * SF, Math.floor(fi / SCOLS) * SF, SF, SF, -w / 2, -h + CELL * 0.5, w, h); c.restore(); }
    }
    // particles
    for (const q of this.parts) { c.globalAlpha = Math.min(1, q.life * 3); c.fillStyle = q.c; c.fillRect(q.x * CELL - q.s / 2, q.y * CELL - q.s / 2, q.s, q.s); } c.globalAlpha = 1;
    // darkness themes: lantern around the ant
    if (th.dark) { c.setTransform(1, 0, 0, 1, 0, 0); const ax = (this.ant.x * CELL - this.camX) * this.zoom + sx, ay = (this.ant.y * CELL - this.camY) * this.zoom + sy; const g = c.createRadialGradient(ax, ay, CELL * 1.6 * this.zoom, ax, ay, CELL * 5.5 * this.zoom); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.88)"); c.fillStyle = g; c.fillRect(0, 0, W, H); }
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (this.flash > 0) { c.fillStyle = `rgba(255,60,60,${this.flash * 0.35})`; c.fillRect(0, 0, W, H); }
    if (this.state === "idle") { c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(0, 0, W, H); }
    if (this.transT > 0 && this.state === "play") {
      const n = Math.ceil(this.transT - 0.2); const frac = (this.transT - 0.2) % 1; const k = Math.min(W, H) / 400;
      c.fillStyle = "rgba(0,0,0,0.55)"; c.fillRect(0, 0, W, H); c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = "rgba(255,255,255,0.85)"; c.font = `800 ${Math.round(16 * k)}px system-ui, sans-serif`; c.fillText(`FLOOR ${this.floor}`, W / 2, H / 2 - 62 * k);
      c.fillStyle = this.theme.accent || "#fff"; c.font = `900 ${Math.round(26 * k)}px system-ui, sans-serif`; c.fillText(this.transLabel.toUpperCase(), W / 2, H / 2 - 34 * k);
      const info = [this.mods.spider ? `spiders ×${this.mods.spider}` : "", this.mods.dark ? "dark" : "", this.mods.wallHits ? `walls ${this.mods.wallHits} hits` : "", this.mods.breakCooldown ? "pick cooldown" : "", this.mods.relentless ? "relentless" : "", this.mods.timer ? "fast clock" : "", this.mods.breaks ? `${this.mods.breaks} breaks` : ""].filter(Boolean).join(" · ");
      if (info) { c.fillStyle = "rgba(255,255,255,0.6)"; c.font = `600 ${Math.round(11 * k)}px system-ui, sans-serif`; c.fillText(info, W / 2, H / 2 - 12 * k); }
      if (n >= 1) { c.save(); c.translate(W / 2, H / 2 + 40 * k); c.scale(1 + frac * 0.35, 1 + frac * 0.35); c.globalAlpha = 0.4 + frac * 0.6; c.fillStyle = "#fff"; c.shadowColor = this.theme.accent || "#60a5fa"; c.shadowBlur = 30; c.font = `900 ${Math.round(80 * k)}px system-ui, sans-serif`; c.fillText(String(n), 0, 0); c.restore(); }
    }
  }
}

function hexA(col: string, a: number) { let r = 0, g = 0, b = 0; if (col.startsWith("#")) { const h = col.slice(1); const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16); r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255; } else { const m = col.match(/\d+/g); if (m) { r = +m[0]; g = +m[1]; b = +m[2]; } } return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`; }
function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
function mulberry(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function cssColor(v: string, fallback: string) { return v && !v.includes("gradient") ? v : fallback; }
/** themes keep CSS gradients for walls; pull a solid tone out of them */
function wallBase(th: Theme) { if (th.wall.startsWith("#")) return th.wall; const m = th.wall.match(/rgba?\(([^)]+)\)/); if (m) { const [r, g, b] = m[1].split(",").map((s) => parseFloat(s)); return `rgb(${r | 0},${g | 0},${b | 0})`; } return "#4a3526"; }
function shadeCss(col: string, k: number) { let r = 0, g = 0, b = 0; if (col.startsWith("#")) { const h = col.slice(1); const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16); r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255; } else { const m = col.match(/\d+/g); if (m) { r = +m[0]; g = +m[1]; b = +m[2]; } } return `rgb(${clamp(r * k, 0, 255) | 0},${clamp(g * k, 0, 255) | 0},${clamp(b * k, 0, 255) | 0})`; }
