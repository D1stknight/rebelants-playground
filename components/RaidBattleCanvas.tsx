// components/RaidBattleCanvas.tsx — THE RAID live battle replay (canvas 2D) — v2 "real war" pass
// Plays back the already-simulated `slots` as a choreographed 20 v 20 war.
// Purely visual: outcomes are read from slots[i].survived — nothing here changes results.
import React, { useEffect, useRef, useState } from "react";

type AntRole = "scout" | "soldier" | "carrier" | "guard" | "bomber";
type Slot = { role: AntRole; survived: boolean | null; boosted?: boolean };
type FactionLike = {
  id: string; name: string;
  colors: { primary: string; secondary: string; glow: string; text: string };
  roles: Record<AntRole, { img: string; label: string }>;
};

type Props = {
  slots: Slot[];
  faction: FactionLike;
  enemy: FactionLike;
  stepMs?: number;                         // cadence per ant (default 1150)
  onUnitResolved?: (index: number, survived: boolean) => void;
  onComplete?: () => void;
  height?: number;
};

// ── Sprite loading + background knock-out ────────────────────────────────────
const SPRITE_PX = 192;
const spriteCache = new Map<string, Promise<HTMLCanvasElement | null>>();

function knockOutBackground(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d"); if (!ctx) return;
  const { width: w, height: h } = c;
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
  let sr = 0, sg = 0, sb = 0;
  for (const o of corners) { sr += d[o]; sg += d[o + 1]; sb += d[o + 2]; }
  sr /= 4; sg /= 4; sb /= 4;
  const TOL = 42;
  const near = (o: number) => Math.abs(d[o] - sr) + Math.abs(d[o + 1] - sg) + Math.abs(d[o + 2] - sb) < TOL * 3;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = y * w + x; if (seen[i]) return; seen[i] = 1; if (near(i * 4)) stack.push(i); };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop() as number; const x = i % w, y = (i - x) / w;
    d[i * 4 + 3] = 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  const a2 = new Uint8ClampedArray(d.length); a2.set(d);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const o = (y * w + x) * 4; if (d[o + 3] === 0) continue;
    let t = 0; if (d[o - 1] === 0) t++; if (d[o + 7] === 0) t++; if (d[o - w * 4 + 3] === 0) t++; if (d[o + w * 4 + 3] === 0) t++;
    if (t > 0) a2[o + 3] = Math.max(60, 255 - t * 70);
  }
  img.data.set(a2);
  ctx.putImageData(img, 0, 0);
}

function loadSprite(url: string): Promise<HTMLCanvasElement | null> {
  const hit = spriteCache.get(url); if (hit) return hit;
  const p = new Promise<HTMLCanvasElement | null>((resolve) => {
    if (typeof window === "undefined") { resolve(null); return; }
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = SPRITE_PX; c.height = SPRITE_PX;
        const ctx = c.getContext("2d"); if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, SPRITE_PX, SPRITE_PX);
        knockOutBackground(c);
        resolve(c);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  spriteCache.set(url, p); return p;
}

// ── Sim types ────────────────────────────────────────────────────────────────
type Side = "ally" | "enemy";
type Unit = {
  id: number; side: Side; role: AntRole; slotIdx: number; row: number;
  x: number; y: number; tx: number; ty: number; homeX: number; homeY: number;
  px: number; py: number;                  // previous position (for lean/dust)
  alive: boolean; dying: number; deathVX: number; deathVY: number; deathSpin: number;
  speed: number; bob: number; idleSeed: number; flip: boolean;
  carrying: boolean; boosted: boolean; flash: number; hit: number; lunge: number;
  resolved: boolean; fled: boolean; skirmish: number;
};
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; grav: number; kind: "dust" | "spark" | "smoke" | "ember" | "ring" | "slash" | "shock" | "fire"; rot?: number };
type Bomb = { x: number; y: number; sx: number; sy: number; ex: number; ey: number; t: number; dur: number; done: boolean; onLand: () => void };
type Feed = { id: number; text: string; tone: "good" | "bad" | "boom" };

const ROLE_EMOJI: Record<AntRole, string> = { scout: "🔍", soldier: "⚔️", carrier: "🎒", guard: "🛡️", bomber: "💥" };

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const alphaOf = (rgba: string, a: number) => rgba.replace(/[\d.]+\)$/, `${a})`);

export default function RaidBattleCanvas({ slots, faction, enemy, stepMs = 1150, onUnitResolved, onComplete, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [hud, setHud] = useState({ allyAlive: slots.length, enemyAlive: slots.length, carriersHome: 0, current: 0, done: false, phase: "MARCH" as "MARCH" | "BATTLE" | "FINALE" });
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1); speedRef.current = speed;
  const cbRef = useRef({ onUnitResolved, onComplete }); cbRef.current = { onUnitResolved, onComplete };

  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
  const H = height ?? (isMobile ? 320 : 540);

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current; if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    let disposed = false;
    const rand = rng(Date.now() & 0xffffff);

    // ── size
    let W = wrap.clientWidth || 900; let dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => { W = wrap.clientWidth || 900; dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + "px"; canvas.style.height = H + "px"; };
    resize(); window.addEventListener("resize", resize);

    // ── assets
    const sprites: Record<string, HTMLCanvasElement | null> = {};
    const roles: AntRole[] = ["scout", "soldier", "carrier", "guard", "bomber"];
    roles.forEach(r => { loadSprite(faction.roles[r].img).then(c => { sprites["ally_" + r] = c; }); loadSprite(enemy.roles[r].img).then(c => { sprites["enemy_" + r] = c; }); });
    const bg = new Image(); bg.src = "/ui/raid-bg.jpg"; let bgReady = false; bg.onload = () => { bgReady = true; };

    // ── world layout (perspective ground: back rows higher + smaller)
    const ROWS = 5;
    const groundTop = () => H * 0.40, groundBot = () => H * 0.88;
    const rowY = (row: number) => groundTop() + (groundBot() - groundTop()) * ((row + 0.5) / ROWS);
    const rowScale = (row: number) => 0.74 + (row / (ROWS - 1)) * 0.40;      // 0.74 back → 1.14 front
    const baseScale = () => Math.max(0.36, Math.min(0.6, W / 1400)) * (H / 540);
    const N = slots.length;
    const MID = () => W * 0.5;

    // enemy composition: seeded, warrior-heavy
    const enemyRoles: AntRole[] = Array.from({ length: N }, () => {
      const r = rand(); return r < 0.4 ? "soldier" : r < 0.7 ? "guard" : r < 0.85 ? "scout" : r < 0.95 ? "bomber" : "carrier";
    });

    const units: Unit[] = [];
    // loose battle line: 4 columns deep, spread wide, staggered by row
    const mk = (side: Side, role: AntRole, i: number): Unit => {
      const row = i % ROWS, col = Math.floor(i / ROWS);            // 0..3
      const y = rowY(row) + (rand() - 0.5) * 14;
      const colGap = W * 0.085, stagger = (row % 2) * colGap * 0.5;
      const frontX = side === "ally" ? W * 0.40 : W * 0.60;
      const homeX = side === "ally" ? frontX - col * colGap - stagger - rand() * 14 : frontX + col * colGap + stagger + rand() * 14;
      const startX = side === "ally" ? -90 - col * 70 - rand() * 60 : W + 90 + col * 70 + rand() * 60;
      return { id: units.length, side, role, slotIdx: i, row, x: startX, y, tx: homeX, ty: y, homeX, homeY: y, px: startX, py: y, alive: true, dying: 0, deathVX: 0, deathVY: 0, deathSpin: 0, speed: 1, bob: rand() * 6.28, idleSeed: rand() * 100, flip: side === "enemy", carrying: false, boosted: side === "ally" && !!slots[i]?.boosted, flash: 0, hit: 0, lunge: 0, resolved: false, fled: false, skirmish: 0 };
    };
    slots.forEach((s, i) => units.push(mk("ally", s.role, i)));
    enemyRoles.forEach((r, i) => units.push(mk("enemy", r, i)));
    const allies = units.filter(u => u.side === "ally"), enemies = units.filter(u => u.side === "enemy");

    const particles: Particle[] = []; const bombs: Bomb[] = [];
    let shake = 0, zoom = 1, zoomTarget = 1, focusX = W / 2, focusY = H * 0.64, focusTX = W / 2, focusTY = H * 0.64;
    let hitStop = 0;                    // seconds of near-freeze remaining
    let flashWhite = 0;                 // full-screen flash alpha
    let feedId = 0; const pushFeed = (text: string, tone: Feed["tone"]) => { setFeed(f => [...f.slice(-4), { id: ++feedId, text, tone }]); };

    const puff = (x: number, y: number, n: number, color: string, kind: Particle["kind"], spread = 2.2, up = -1.2, size = 4) => {
      for (let i = 0; i < n; i++) particles.push({ x, y, vx: (rand() - 0.5) * spread * 2, vy: (rand() - 0.8) * spread + up, life: 0, max: 0.5 + rand() * 0.8, size: size * 0.5 + rand() * size, color, grav: kind === "spark" ? 7 : kind === "smoke" ? -0.5 : kind === "ember" ? -1.2 : 3, kind });
    };
    const ring = (x: number, y: number, color: string, size: number, max = 0.5, kind: Particle["kind"] = "ring") => particles.push({ x, y, vx: 0, vy: 0, life: 0, max, size, color, grav: 0, kind });
    const slash = (x: number, y: number, dir: number) => particles.push({ x, y, vx: dir * 1.4, vy: 0, life: 0, max: 0.22, size: 28, color: "rgba(255,255,255,0.95)", grav: 0, kind: "slash", rot: dir > 0 ? -0.6 : Math.PI + 0.6 });

    const kill = (u: Unit, fromX: number, force = 1) => {
      if (!u.alive) return; u.alive = false; u.dying = 0.0001; u.carrying = false;
      const dir = u.x >= fromX ? 1 : -1;
      u.deathVX = dir * (60 + rand() * 60) * force; u.deathVY = -(90 + rand() * 80) * force; u.deathSpin = dir * (1.5 + rand() * 2) * force;
      puff(u.x, u.y, 12, u.side === "ally" ? "rgba(248,113,113,0.95)" : "rgba(253,224,71,0.95)", "dust", 2.6, -1.5, 4);
      puff(u.x, u.y + 10, 10, "rgba(120,110,100,0.6)", "smoke", 1.4, -1.2, 6);
      ring(u.x, u.y, u.side === "ally" ? "rgba(248,113,113,0.8)" : "rgba(253,224,71,0.8)", 26, 0.35);
      shake = Math.max(shake, 6 * force);
    };
    const nearestEnemy = (u: Unit) => { let best: Unit | null = null, bd = 1e9; for (const e of enemies) { if (!e.alive) continue; const d = Math.abs(e.y - u.y) * 2.2 + Math.abs(e.x - u.x); if (d < bd) { bd = d; best = e; } } return best; };
    const label = (u: Unit) => `${faction.roles[u.role]?.label || u.role} #${u.slotIdx + 1}`;
    const elabel = (u: Unit) => `${enemy.name} ${enemy.roles[u.role]?.label || u.role}`;

    // ── timeline
    const MARCH = 2800, STEP = stepMs, FINALE = 2800;
    const actStart = (i: number) => MARCH + i * STEP;
    const battleEnd = actStart(N - 1) + STEP;
    let t = 0, last = performance.now(), completed = false, finaleShown = false, clashCalled = false;
    const acts = slots.map(() => ({ started: false, impact: false, resolved: false, target: null as Unit | null, bombLanded: false }));
    let carriersHome = 0;

    const detonate = (x: number, y: number, bomber: Unit) => {
      flashWhite = 0.55; shake = 22; hitStop = 0.12;
      puff(x, y, 46, "rgba(251,146,60,1)", "spark", 6, -2.5, 5); puff(x, y, 30, "rgba(255,255,255,0.95)", "spark", 5, -1.5, 4);
      puff(x, y, 40, "rgba(60,50,45,0.85)", "smoke", 3, -3, 14); puff(x, y, 26, "rgba(255,170,60,0.9)", "ember", 3.5, -3, 3);
      ring(x, y, "rgba(255,200,120,0.9)", 40, 0.45); ring(x, y, "rgba(255,255,255,0.6)", 70, 0.6, "shock");
      particles.push({ x, y: y - 10, vx: 0, vy: -0.6, life: 0, max: 0.7, size: 70, color: "", grav: -1.5, kind: "fire" });
      for (let i = 0; i < 5; i++) particles.push({ x: x + (rand() - 0.5) * 60, y: y - rand() * 30, vx: (rand() - 0.5) * 1.5, vy: -0.8 - rand(), life: 0, max: 0.45 + rand() * 0.3, size: 26 + rand() * 24, color: "", grav: -1.2, kind: "fire" });
      let n = 0;
      const victims = enemies.filter(e => e.alive).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
      for (const e of victims) { if (n >= 3) break; if (Math.hypot(e.x - x, e.y - y) < 150 || n === 0) { kill(e, x, 1.6); n++; } }
      kill(bomber, x - 40, 1.2);
      pushFeed(`💥 ${label(bomber)} detonated — ${n} ${enemy.name} down`, "boom");
    };

    const doImpact = (i: number) => {
      const u = allies[i], s = slots[i], a = acts[i]; const survived = !!s.survived; const tgt = a.target;
      focusTX = (u.x + (tgt?.x ?? u.x)) / 2; focusTY = u.y - 10; zoomTarget = 1.1;
      hitStop = 0.09;
      if (u.role === "bomber") {
        // lob a bomb at the enemy cluster, detonate on landing
        const ex = tgt ? tgt.x + 10 : W * 0.7, ey = tgt ? tgt.y : u.y;
        bombs.push({ x: u.x, y: u.y - 20, sx: u.x, sy: u.y - 20, ex, ey, t: 0, dur: 0.55, done: false, onLand: () => detonate(ex, ey, u) });
        u.lunge = 1; return;
      }
      u.lunge = 1; slash((u.x + (tgt?.x ?? u.x)) / 2, u.y - 12, 1);
      if (survived) {
        u.flash = 1; puff((u.x + (tgt?.x ?? u.x)) / 2, u.y - 14, 18, "rgba(253,230,138,1)", "spark", 4, -1.5, 4);
        ring((u.x + (tgt?.x ?? u.x)) / 2, u.y - 10, "rgba(255,255,255,0.9)", 22, 0.3);
        if (tgt) { tgt.hit = 1; kill(tgt, u.x, 1); }
        if (u.role === "carrier") { u.carrying = true; pushFeed(`🎒 ${label(u)} grabbed the loot${tgt ? ` — ${elabel(tgt)} down` : ""}`, "good"); }
        else if (u.role === "guard") pushFeed(`🛡️ ${label(u)} held the line${tgt ? ` — ${elabel(tgt)} down` : ""}`, "good");
        else if (u.role === "scout") pushFeed(`🔍 ${label(u)} slipped through${tgt ? ` — ${elabel(tgt)} down` : ""}`, "good");
        else pushFeed(`⚔️ ${label(u)} slew ${tgt ? elabel(tgt) : "an enemy"}`, "good");
      } else {
        u.hit = 1; if (tgt) { tgt.flash = 1; tgt.lunge = 1; slash((u.x + tgt.x) / 2, u.y - 12, -1); }
        puff(u.x, u.y - 10, 14, "rgba(248,113,113,1)", "spark", 3.5, -1.5, 4);
        kill(u, tgt ? tgt.x : u.x + 60, 1);
        pushFeed(`☠ ${label(u)} fell to ${tgt ? elabel(tgt) : `the ${enemy.name}`}`, "bad");
      }
    };

    // background skirmishes: random front-line pairs spar (sparks only, no outcomes)
    let nextSkirmish = MARCH + 400;
    const skirmish = () => {
      const a = allies.filter(u => u.alive && !u.fled && u.resolved), e = enemies.filter(u => u.alive);
      if (!a.length || !e.length) return;
      const u = a[Math.floor(rand() * a.length)], v = e.reduce((b, x) => Math.abs(x.y - u.y) < Math.abs(b.y - u.y) ? x : b, e[0]);
      u.skirmish = 1; v.skirmish = 1; u.lunge = 0.7; v.lunge = 0.7;
      const mx = (u.x + v.x) / 2, my = (u.y + v.y) / 2 - 12;
      puff(mx, my, 8, "rgba(253,230,138,0.9)", "spark", 2.5, -1, 3); slash(mx, my, rand() < 0.5 ? 1 : -1);
    };

    const update = (dtMs: number) => {
      const sp = speedRef.current;
      const lastA = actStart(N - 1); const inFinaleWindow = t > lastA + STEP * 0.42 && t < lastA + STEP * 0.9;
      let scale = sp > 1 ? sp : inFinaleWindow ? 0.35 : 1;
      if (hitStop > 0 && sp === 1) { scale *= 0.18; hitStop -= dtMs / 1000; }
      const dt = (dtMs * scale) / 1000; t += dtMs * scale;

      // march-in: armies walk on, then hold the line
      if (t < MARCH) {
        for (const u of units) { u.tx = u.homeX; u.ty = u.homeY; u.speed = 0.75 + (u.row * 0.05) + ((u.slotIdx * 7) % 5) * 0.04; }
      } else if (!clashCalled) { clashCalled = true; ring(MID(), H * 0.62, "rgba(253,224,71,0.5)", 120, 0.9, "shock"); shake = 4; }

      // acts
      for (let i = 0; i < N; i++) {
        const a = acts[i], u = allies[i], s = slots[i]; const st = actStart(i); if (t < st) break;
        const p = clamp01((t - st) / STEP);
        if (!a.started) {
          a.started = true; a.target = nearestEnemy(u);
          setHud(h => ({ ...h, current: i + 1, phase: "BATTLE" }));
          const meetX = MID();
          if (a.target) { a.target.tx = meetX + 48; a.target.ty = u.y + (rand() - 0.5) * 8; a.target.speed = 1.6; }
          if (u.role === "carrier") { u.tx = W * 0.86; u.ty = u.homeY; }
          else if (u.role === "scout") { u.tx = meetX + 20; u.ty = groundTop() - 4 + (i % 2) * 10; }
          else if (u.role === "bomber") { u.tx = meetX - 80; u.ty = a.target ? a.target.y : u.y; }
          else { u.tx = meetX - 40; u.ty = a.target ? a.target.ty : u.y; }
          u.speed = u.role === "scout" ? 2.2 : u.role === "carrier" ? 2.1 : 1.6;
          focusTX = (u.x + (a.target?.x ?? W * 0.6)) / 2; focusTY = u.y; zoomTarget = 1.04;
          puff(u.x, u.y + 18, 6, "rgba(200,180,150,0.5)", "dust", 1.5, -0.5, 5);
        }
        if (!a.impact && p >= (u.role === "carrier" ? 0.58 : 0.5)) { a.impact = true; doImpact(i); }
        if (!a.resolved && p >= (u.role === "bomber" ? 0.78 : 0.72)) {
          a.resolved = true; u.resolved = true;
          const surv = !!s.survived;
          if (surv) {
            if (u.role === "carrier") { u.tx = -120; u.ty = u.y; u.fled = true; u.speed = 1.6; carriersHome++; }
            else if (u.role === "scout") { u.tx = W + 120; u.fled = true; u.speed = 2.2; }
            else { u.tx = MID() - 60 - (i % 4) * 26 - rand() * 20; u.ty = u.homeY; u.speed = 0.9; }
          }
          if (a.target && a.target.alive) { a.target.tx = a.target.homeX + 30; a.target.ty = a.target.homeY; a.target.speed = 0.9; }
          setHud(h => ({ ...h, allyAlive: allies.filter(x => x.alive).length, enemyAlive: enemies.filter(x => x.alive).length, carriersHome }));
          cbRef.current.onUnitResolved?.(i, surv);
        }
      }

      // skirmishes between acts
      if (t > nextSkirmish && t < battleEnd) { skirmish(); nextSkirmish = t + 500 + rand() * 900; }

      // finale
      if (t > battleEnd && !finaleShown) { finaleShown = true; zoomTarget = 1; focusTX = W / 2; focusTY = H * 0.64; setHud(h => ({ ...h, phase: "FINALE", done: true })); }
      if (t > battleEnd + FINALE && !completed) { completed = true; cbRef.current.onComplete?.(); }

      // bombs
      for (const b of bombs) {
        if (b.done) continue; b.t += dt; const p = clamp01(b.t / b.dur);
        b.x = b.sx + (b.ex - b.sx) * p; b.y = b.sy + (b.ey - b.sy) * p - Math.sin(p * Math.PI) * 110;
        if (rand() < 0.6) particles.push({ x: b.x, y: b.y, vx: (rand() - 0.5), vy: -0.5, life: 0, max: 0.3, size: 2, color: "rgba(255,200,80,1)", grav: 0, kind: "ember" });
        if (p >= 1) { b.done = true; b.onLand(); }
      }

      // movement + idle life
      for (const u of units) {
        u.px = u.x; u.py = u.y;
        if (!u.alive) {
          u.dying = Math.min(1, u.dying + dt * 1.6);
          if (u.dying < 1) { u.x += u.deathVX * dt; u.y += u.deathVY * dt; u.deathVY += 420 * dt; if (u.y > u.homeY + 30) { u.y = u.homeY + 30; u.deathVY = 0; u.deathVX *= 0.6; } }
          continue;
        }
        const dx = u.tx - u.x, dy = u.ty - u.y, dist = Math.hypot(dx, dy);
        if (dist > 0.5) { const stepPx = Math.min(dist, (150 + 130 * u.speed) * u.speed * dt); u.x += dx / dist * stepPx; u.y += dy / dist * stepPx; }
        const moving = dist > 6;
        u.bob += dt * (moving ? 15 * u.speed : 2.2);
        if (moving && rand() < 0.35) particles.push({ x: u.x - (u.x - u.px) * 4, y: u.y + 18 * rowScale(u.row), vx: -(u.x - u.px) * 0.6, vy: -0.4, life: 0, max: 0.35 + rand() * 0.3, size: 3 + rand() * 3, color: "rgba(190,170,140,0.35)", grav: -0.3, kind: "dust" });
        u.flash = Math.max(0, u.flash - dt * 2.5); u.hit = Math.max(0, u.hit - dt * 3); u.lunge = Math.max(0, u.lunge - dt * 3.2); u.skirmish = Math.max(0, u.skirmish - dt * 1.5);
      }

      // particles
      for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.life += dt; if (p.life > p.max) { particles.splice(i, 1); continue; } p.vy += p.grav * dt; p.x += p.vx * 60 * dt; p.y += p.vy * 60 * dt; }
      // camera
      shake = Math.max(0, shake - dt * 26); flashWhite = Math.max(0, flashWhite - dt * 2.2);
      focusTX = Math.max(W * 0.38, Math.min(W * 0.62, focusTX)); focusTY = Math.max(H * 0.58, Math.min(H * 0.68, focusTY));
      zoom += (zoomTarget - zoom) * Math.min(1, dt * 2.4); focusX += (focusTX - focusX) * Math.min(1, dt * 2.6); focusY += (focusTY - focusY) * Math.min(1, dt * 2.6);
    };

    const drawUnit = (u: Unit) => {
      const s = baseScale() * rowScale(u.row) * (u.side === "enemy" ? 0.98 : 1);
      const size = SPRITE_PX * s * 0.62;
      const spr = sprites[(u.side === "ally" ? "ally_" : "enemy_") + u.role];
      const vx = u.x - u.px; const moving = Math.abs(u.tx - u.x) > 6 && u.alive;
      ctx.save();
      // idle life: breathing + tiny weight shift when waiting
      const idle = u.alive && !moving ? Math.sin(u.bob + u.idleSeed) : 0;
      const bobY = u.alive ? (moving ? Math.abs(Math.sin(u.bob)) * -5 : idle * 1.2) : 0;
      ctx.translate(u.x, u.y + bobY);
      // shadow
      ctx.globalAlpha = u.alive ? 0.45 : 0.2; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(0, size * 0.5 - bobY, size * 0.36, size * 0.10, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      if (!u.alive) {
        const d = easeOut(u.dying);
        ctx.rotate(u.deathSpin * d * 0.9 * (u.flip ? -1 : 1) * (u.side === "ally" ? 1 : -1));
        ctx.globalAlpha = 1 - d * 0.7; ctx.filter = `grayscale(${d}) brightness(${1 - d * 0.6})`;
      } else {
        // lean into movement, lunge toward the enemy on attack
        const lean = Math.max(-0.28, Math.min(0.28, vx * 0.035)) + (u.lunge > 0 ? Math.sin(u.lunge * Math.PI) * 0.35 * (u.side === "ally" ? 1 : -1) : 0);
        ctx.rotate(lean + idle * 0.02);
        if (u.lunge > 0) ctx.translate(Math.sin(u.lunge * Math.PI) * 22 * (u.side === "ally" ? 1 : -1), 0);
        const squash = moving ? 1 + Math.sin(u.bob) * 0.05 : 1 + idle * 0.015;
        ctx.scale(1 / squash, squash);
      }
      if (u.flip) ctx.scale(-1, 1);
      if (u.boosted && u.alive) { ctx.shadowColor = "rgba(244,114,182,0.95)"; ctx.shadowBlur = 18; }
      if (u.flash > 0 && u.alive) { ctx.shadowColor = u.side === "ally" ? faction.colors.glow : enemy.colors.glow; ctx.shadowBlur = 30 * u.flash; }
      if (spr) ctx.drawImage(spr, -size / 2, -size / 2, size, size);
      else { ctx.font = `${size * 0.6}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(ROLE_EMOJI[u.role], 0, 0); }
      if (u.hit > 0 && u.alive) { ctx.globalCompositeOperation = "source-atop"; ctx.fillStyle = `rgba(255,60,60,${u.hit * 0.65})`; ctx.fillRect(-size / 2, -size / 2, size, size); ctx.globalCompositeOperation = "source-over"; }
      if (u.flash > 0.4 && u.alive) { ctx.globalCompositeOperation = "source-atop"; ctx.fillStyle = `rgba(255,255,255,${(u.flash - 0.4) * 0.9})`; ctx.fillRect(-size / 2, -size / 2, size, size); ctx.globalCompositeOperation = "source-over"; }
      ctx.restore();
      if (u.carrying && u.alive) { ctx.save(); ctx.translate(u.x, u.y - size * 0.55 + Math.sin(u.bob) * 3); ctx.font = `${Math.max(14, size * 0.3)}px serif`; ctx.textAlign = "center"; ctx.shadowColor = "rgba(251,191,36,1)"; ctx.shadowBlur = 16; ctx.fillText("📦", 0, 0); ctx.restore(); }
      if (u.side === "ally" && u.alive) { ctx.save(); ctx.font = `700 ${Math.max(9, size * 0.15)}px monospace`; ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillText(String(u.slotIdx + 1), u.x, u.y + size * 0.64); ctx.restore(); }
    };

    const drawParticle = (p: Particle) => {
      const a = 1 - p.life / p.max;
      if (p.kind === "ring" || p.kind === "shock") { ctx.globalAlpha = a * (p.kind === "shock" ? 0.5 : 0.9); ctx.strokeStyle = p.color; ctx.lineWidth = p.kind === "shock" ? 3 : 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.3 + (1 - a) * 1.6), 0, Math.PI * 2); ctx.stroke(); return; }
      if (p.kind === "fire") { const r = p.size * (0.4 + (1 - a) * 0.9); const fg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); fg.addColorStop(0, `rgba(255,250,220,${a})`); fg.addColorStop(0.35, `rgba(255,170,60,${a * 0.9})`); fg.addColorStop(0.75, `rgba(200,60,20,${a * 0.6})`); fg.addColorStop(1, "rgba(60,20,10,0)"); ctx.globalAlpha = 1; ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); return; }
      if (p.kind === "slash") { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate((p.rot ?? 0) + (1 - a) * 1.6); ctx.globalAlpha = a; ctx.strokeStyle = p.color; ctx.lineWidth = 3; ctx.shadowColor = "#fff"; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(0, 0, p.size, -0.9, 0.9); ctx.stroke(); ctx.restore(); return; }
      ctx.globalAlpha = a * (p.kind === "smoke" ? 0.45 : p.kind === "dust" ? 0.7 : 1);
      ctx.fillStyle = p.color; ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.kind === "smoke" ? 1 + p.life * 2.5 : p.kind === "dust" ? 1 + p.life : a), 0, Math.PI * 2); ctx.fill();
    };

    let ambientT = 0; const embers: { x: number; y: number; s: number; v: number }[] = Array.from({ length: 40 }, () => ({ x: rand() * 1400, y: rand() * 600, s: 1 + rand() * 2, v: 10 + rand() * 25 }));

    const draw = (dtMs: number) => {
      ambientT += dtMs / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // background with parallax + slow drift
      if (bgReady) {
        const ar = bg.width / bg.height; let bw = W * 1.2, bh = bw / ar; if (bh < H * 1.2) { bh = H * 1.2; bw = bh * ar; }
        const par = (focusX - W / 2) * 0.08 + Math.sin(ambientT * 0.15) * 6;
        ctx.drawImage(bg, (W - bw) / 2 - par, (H - bh) / 2 - H * 0.06, bw, bh);
      } else { ctx.fillStyle = "#0a1226"; ctx.fillRect(0, 0, W, H); }
      // fire flicker from the enemy fortress
      const flick = 0.06 + Math.sin(ambientT * 7.3) * 0.02 + Math.sin(ambientT * 13.1) * 0.015;
      const fg = ctx.createRadialGradient(W * 0.78, H * 0.35, 20, W * 0.78, H * 0.35, W * 0.6); fg.addColorStop(0, `rgba(255,120,40,${flick + 0.08})`); fg.addColorStop(1, "rgba(255,120,40,0)"); ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(2,6,23,0.6)"); g.addColorStop(0.42, "rgba(2,6,23,0.2)"); g.addColorStop(1, "rgba(2,6,23,0.92)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const lg = ctx.createLinearGradient(0, 0, W, 0); lg.addColorStop(0, alphaOf(faction.colors.glow, 0.22)); lg.addColorStop(0.42, "rgba(0,0,0,0)"); lg.addColorStop(0.58, "rgba(0,0,0,0)"); lg.addColorStop(1, alphaOf(enemy.colors.glow, 0.22)); ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);

      // camera
      ctx.save();
      const sx = (rand() - 0.5) * shake, sy = (rand() - 0.5) * shake;
      ctx.translate(W / 2 + sx, H * 0.64 + sy); ctx.scale(zoom, zoom); ctx.translate(-focusX, -focusY);

      // ground fog band
      const fog = ctx.createLinearGradient(0, groundTop() - 30, 0, groundBot() + 40); fog.addColorStop(0, "rgba(120,90,70,0)"); fog.addColorStop(0.5, "rgba(120,90,70,0.10)"); fog.addColorStop(1, "rgba(30,20,20,0.35)"); ctx.fillStyle = fog; ctx.fillRect(-200, groundTop() - 30, W + 400, groundBot() - groundTop() + 80);
      // loot pile
      ctx.save(); ctx.translate(W * 0.9, groundBot() - 6); ctx.font = `${Math.max(20, baseScale() * 64)}px serif`; ctx.textAlign = "center"; ctx.shadowColor = "rgba(251,191,36,0.9)"; ctx.shadowBlur = 20; ctx.fillText("📦", 0, 0); ctx.fillText("📦", -22, 10); ctx.fillText("📦", 20, 12); ctx.restore();

      // ground particles (dust/smoke) below units, everything else above
      const sorted = [...units].sort((a, b) => (a.alive === b.alive ? a.y - b.y : a.alive ? 1 : -1));
      for (const p of particles) if (p.kind === "dust" || p.kind === "smoke") drawParticle(p);
      ctx.globalAlpha = 1;
      for (const u of sorted) drawUnit(u);
      for (const p of particles) if (p.kind !== "dust" && p.kind !== "smoke") drawParticle(p);
      ctx.globalAlpha = 1;
      // bombs
      for (const b of bombs) { if (b.done) continue; ctx.save(); ctx.translate(b.x, b.y); ctx.fillStyle = "#1c1917"; ctx.shadowColor = "rgba(255,160,60,1)"; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#fde68a"; ctx.beginPath(); ctx.arc(4, -7, 2.2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
      ctx.restore();

      // rising embers (screen space)
      ctx.save(); for (const e of embers) { e.y -= e.v * (dtMs / 1000); e.x += Math.sin(ambientT + e.y * 0.01) * 0.3; if (e.y < -10) { e.y = H + 10; e.x = rand() * W; } if (e.x > W) e.x -= W; ctx.globalAlpha = 0.35 + Math.sin(ambientT * 3 + e.x) * 0.25; ctx.fillStyle = "rgba(255,170,70,1)"; ctx.beginPath(); ctx.arc(e.x, e.y, e.s, 0, Math.PI * 2); ctx.fill(); } ctx.restore();

      // vignette + letterbox + flash
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.72); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.6)"); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(0,0,0,0.85)"; ctx.fillRect(0, 0, W, H * 0.045); ctx.fillRect(0, H - H * 0.045, W, H * 0.045);
      if (flashWhite > 0) { ctx.fillStyle = `rgba(255,240,220,${flashWhite})`; ctx.fillRect(0, 0, W, H); }
    };

    let raf = 0;
    const loop = (now: number) => {
      if (disposed) return;
      const dtMs = Math.min(50, now - last); last = now;
      update(dtMs); draw(dtMs);
      raf = requestAnimationFrame(loop);
    };
    // Debug hook (build-time flag only): step the sim manually from devtools when the tab is hidden and rAF is starved.
    const manual = process.env.NEXT_PUBLIC_RAID_DEBUG === "1";
    if (manual) (window as any).__raidStep = (ms: number) => { let left = ms; while (left > 0) { const d = Math.min(40, left); update(d); left -= d; } draw(16); };
    else raf = requestAnimationFrame(loop);
    return () => { disposed = true; cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const FONT = "'Noto Serif JP', 'Hiragino Mincho ProN', serif";
  const survivors = slots.filter(s => s.survived).length;
  const carriers = slots.filter(s => s.role === "carrier" && s.survived).length;
  const finaleTitle = hud.done ? (survivors >= Math.ceil(slots.length * 0.65) && carriers >= 4 ? "LEGENDARY HAUL" : survivors >= Math.ceil(slots.length * 0.4) && carriers >= 1 ? "RAID SUCCESSFUL" : survivors >= 5 ? "CRATE SECURED" : "ROUTED") : "";
  const finaleColor = finaleTitle === "LEGENDARY HAUL" ? "#fbbf24" : finaleTitle === "RAID SUCCESSFUL" ? "#60a5fa" : finaleTitle === "CRATE SECURED" ? "#34d399" : "#f87171";

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", borderRadius: 18, overflow: "hidden", background: "#050a16", border: `1px solid ${faction.colors.primary}44`, boxShadow: `0 0 60px ${alphaOf(faction.colors.glow, 0.2)}, 0 30px 60px rgba(0,0,0,0.6)` }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: H }} />

      {/* top HUD */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", fontFamily: FONT, fontSize: isMobile ? 9 : 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#cbd5e1", background: `linear-gradient(90deg, ${alphaOf(faction.colors.glow, 0.4)}, rgba(0,0,0,0.45) 42%, rgba(0,0,0,0.45) 58%, ${alphaOf(enemy.colors.glow, 0.4)})`, pointerEvents: "none" }}>
        <span><b style={{ color: faction.colors.text }}>{faction.name}</b> · {hud.allyAlive}/{slots.length} · 🎒 {hud.carriersHome}</span>
        <span style={{ color: "#fde68a", fontWeight: 900 }}>{hud.phase === "MARCH" ? "⚔ ARMIES TAKE THE FIELD" : hud.phase === "BATTLE" ? `ANT ${hud.current} / ${slots.length}` : "⚔ BATTLE OVER"}</span>
        <span>{hud.enemyAlive}/{slots.length} · <b style={{ color: enemy.colors.text }}>{enemy.name}</b></span>
      </div>
      <div style={{ position: "absolute", top: isMobile ? 32 : 40, left: 14, right: 14, display: "flex", gap: 10, pointerEvents: "none" }}>
        <div style={{ flex: 1, height: 5, background: "rgba(0,0,0,0.6)", borderRadius: 3, overflow: "hidden" }}><div style={{ width: `${(hud.allyAlive / slots.length) * 100}%`, height: "100%", background: `linear-gradient(90deg, ${faction.colors.primary}, ${faction.colors.text})`, transition: "width .5s" }} /></div>
        <div style={{ flex: 1, height: 5, background: "rgba(0,0,0,0.6)", borderRadius: 3, overflow: "hidden", display: "flex", justifyContent: "flex-end" }}><div style={{ width: `${(hud.enemyAlive / slots.length) * 100}%`, height: "100%", background: `linear-gradient(90deg, ${enemy.colors.text}, ${enemy.colors.primary})`, transition: "width .5s" }} /></div>
      </div>

      {!hud.done && (
        <button type="button" onClick={() => setSpeed(s => (s === 1 ? 4 : 1))}
          style={{ position: "absolute", top: isMobile ? 42 : 52, right: 12, fontFamily: FONT, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", padding: "6px 12px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.25)", background: speed > 1 ? "rgba(253,224,71,0.2)" : "rgba(0,0,0,0.55)", color: speed > 1 ? "#fde68a" : "rgba(255,255,255,0.75)", cursor: "pointer" }}>
          {speed > 1 ? "⏩ 4× — NORMAL" : "⏩ SKIP"}
        </button>
      )}

      {hud.done && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", animation: "raidBannerIn .7s cubic-bezier(.2,.9,.3,1.2) both" }}>
          <div style={{ fontFamily: FONT, fontSize: "clamp(24px,5vw,54px)", fontWeight: 900, letterSpacing: "0.32em", textTransform: "uppercase", color: finaleColor, textShadow: `0 0 30px ${finaleColor}, 0 0 80px ${finaleColor}88`, padding: "14px 34px", border: `1px solid ${finaleColor}66`, borderRadius: 999, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(5px)" }}>
            {finaleTitle}
          </div>
        </div>
      )}

      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "10px 14px 12px", background: "linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.8))", pointerEvents: "none", display: "flex", flexDirection: "column", gap: 3 }}>
        {feed.slice(-3).map((f, i, arr) => (
          <div key={f.id} style={{ fontFamily: FONT, fontSize: isMobile ? 10 : 12, letterSpacing: "0.04em", color: f.tone === "good" ? "#86efac" : f.tone === "boom" ? "#fdba74" : "#fca5a5", opacity: 0.4 + (i + 1) / arr.length * 0.6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textShadow: "0 1px 2px #000" }}>{f.text}</div>
        ))}
      </div>
      <style>{`@keyframes raidBannerIn{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}
