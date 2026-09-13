// components/RaidBattleCanvas.tsx — THE RAID live battle replay (canvas 2D)
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
  stepMs?: number;                         // cadence per ant (default 650)
  onUnitResolved?: (index: number, survived: boolean) => void;
  onComplete?: () => void;
  height?: number;
};

// ── Sprite loading + background knock-out ────────────────────────────────────
const SPRITE_PX = 160;
const spriteCache = new Map<string, Promise<HTMLCanvasElement | null>>();

function knockOutBackground(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d"); if (!ctx) return;
  const { width: w, height: h } = c;
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  // seed colour = average of the 4 corners
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
  // soften edge: any opaque pixel touching a transparent one gets partial alpha
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
  id: number; side: Side; role: AntRole; slotIdx: number;
  x: number; y: number; tx: number; ty: number; homeX: number; homeY: number;
  alive: boolean; dying: number; // dying: 0..1 fall progress
  speed: number; bob: number; flip: boolean; scale: number;
  carrying: boolean; boosted: boolean; flash: number; hit: number;
  resolved: boolean; fled: boolean;
};
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; grav: number; kind: "dust" | "spark" | "smoke" | "ember" };
type Feed = { id: number; text: string; tone: "good" | "bad" | "boom" };

const ROLE_EMOJI: Record<AntRole, string> = { scout: "🔍", soldier: "⚔️", carrier: "🎒", guard: "🛡️", bomber: "💥" };

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const ease = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export default function RaidBattleCanvas({ slots, faction, enemy, stepMs = 650, onUnitResolved, onComplete, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [hud, setHud] = useState({ allyAlive: slots.length, enemyAlive: slots.length, carriersHome: 0, current: 0, done: false, phase: "MARCH" as "MARCH" | "BATTLE" | "FINALE" });
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1); speedRef.current = speed;
  const cbRef = useRef({ onUnitResolved, onComplete }); cbRef.current = { onUnitResolved, onComplete };

  const H = height ?? (typeof window !== "undefined" && window.innerWidth < 640 ? 240 : 340);

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

    // ── world layout
    const groundTop = () => H * 0.42, groundBot = () => H * 0.9;
    const rowY = (row: number, rows: number) => groundTop() + (groundBot() - groundTop()) * ((row + 0.5) / rows);
    const unitScale = () => Math.max(0.42, Math.min(0.62, W / 1200));
    const N = slots.length;

    // enemy composition: seeded, warrior-heavy
    const enemyRoles: AntRole[] = Array.from({ length: N }, () => {
      const r = rand(); return r < 0.4 ? "soldier" : r < 0.7 ? "guard" : r < 0.85 ? "scout" : r < 0.95 ? "bomber" : "carrier";
    });

    const units: Unit[] = [];
    const ROWS = 4;
    const mk = (side: Side, role: AntRole, i: number): Unit => {
      const row = i % ROWS, col = Math.floor(i / ROWS);
      const y = rowY(row, ROWS) + (rand() - 0.5) * 10;
      const homeX = side === "ally" ? W * 0.30 - col * 34 - row * 6 : W * 0.70 + col * 34 + row * 6;
      const startX = side === "ally" ? -60 - col * 40 : W + 60 + col * 40;
      return { id: units.length, side, role, slotIdx: i, x: startX, y, tx: homeX, ty: y, homeX, homeY: y, alive: true, dying: 0, speed: 1, bob: rand() * 6.28, flip: side === "enemy", scale: 1, carrying: false, boosted: side === "ally" && !!slots[i]?.boosted, flash: 0, hit: 0, resolved: false, fled: false };
    };
    slots.forEach((s, i) => units.push(mk("ally", s.role, i)));
    enemyRoles.forEach((r, i) => units.push(mk("enemy", r, i)));
    const allies = units.filter(u => u.side === "ally"), enemies = units.filter(u => u.side === "enemy");

    const particles: Particle[] = [];
    let shake = 0, zoom = 1, zoomTarget = 1, focusX = W / 2, focusY = H * 0.62, focusTX = W / 2, focusTY = H * 0.62;
    let feedId = 0; const pushFeed = (text: string, tone: Feed["tone"]) => { setFeed(f => [...f.slice(-4), { id: ++feedId, text, tone }]); };

    const puff = (x: number, y: number, n: number, color: string, kind: Particle["kind"], spread = 2.2, up = -1.2) => {
      for (let i = 0; i < n; i++) particles.push({ x, y, vx: (rand() - 0.5) * spread * 2, vy: (rand() - 0.8) * spread + up, life: 0, max: 0.5 + rand() * 0.7, size: 2 + rand() * 4, color, grav: kind === "spark" ? 6 : kind === "smoke" ? -0.6 : 3, kind });
    };
    const kill = (u: Unit, cause: string) => {
      if (!u.alive) return; u.alive = false; u.dying = 0.0001; u.carrying = false;
      puff(u.x, u.y, 14, u.side === "ally" ? "rgba(248,113,113,0.9)" : "rgba(253,224,71,0.9)", "dust", 2.4);
      puff(u.x, u.y, 8, "rgba(120,110,100,0.7)", "smoke", 1.2, -1.6);
      shake = Math.max(shake, 5);
      void cause;
    };
    const nearestEnemy = (u: Unit) => { let best: Unit | null = null, bd = 1e9; for (const e of enemies) { if (!e.alive) continue; const d = Math.abs(e.y - u.y) * 3 + Math.abs(e.x - u.x); if (d < bd) { bd = d; best = e; } } return best; };
    const label = (u: Unit) => `${faction.roles[u.role]?.label || u.role} #${u.slotIdx + 1}`;
    const elabel = (u: Unit) => `${enemy.name} ${enemy.roles[u.role]?.label || u.role}`;

    // ── timeline
    const MARCH = 1600, STEP = stepMs, FINALE = 1900;
    const actStart = (i: number) => MARCH + i * STEP;
    const battleEnd = actStart(N - 1) + STEP;
    let t = 0, last = performance.now(), completed = false, finaleShown = false;
    const acts = slots.map(() => ({ started: false, impact: false, resolved: false, target: null as Unit | null }));
    let carriersHome = 0;

    const doImpact = (i: number) => {
      const u = allies[i], s = slots[i], a = acts[i]; const survived = !!s.survived; const tgt = a.target;
      focusTX = u.x; focusTY = u.y; zoomTarget = 1.12;
      if (u.role === "bomber") {
        // detonate: takes up to 3 enemies
        puff(u.x, u.y, 40, "rgba(251,146,60,1)", "spark", 5, -2); puff(u.x, u.y, 26, "rgba(255,255,255,0.9)", "spark", 4, -1); puff(u.x, u.y, 30, "rgba(60,50,45,0.8)", "smoke", 2.5, -2.5);
        shake = 14; let n = 0;
        for (const e of enemies) { if (!e.alive) continue; if (Math.hypot(e.x - u.x, e.y - u.y) < 110 && n < 3) { kill(e, "blast"); n++; } }
        if (n === 0) { const e = nearestEnemy(u); if (e) { kill(e, "blast"); n = 1; } }
        kill(u, "blast");
        pushFeed(`💥 ${label(u)} detonated — ${n} ${enemy.name} down`, "boom");
        u.resolved = true; return;
      }
      if (survived) {
        u.flash = 1; puff((u.x + (tgt?.x ?? u.x)) / 2, u.y - 10, 16, "rgba(253,230,138,1)", "spark", 3.5, -1);
        if (tgt) { tgt.hit = 1; kill(tgt, "slain"); }
        if (u.role === "carrier") { u.carrying = true; pushFeed(`🎒 ${label(u)} grabbed the loot${tgt ? ` — ${elabel(tgt)} down` : ""}`, "good"); }
        else if (u.role === "guard") pushFeed(`🛡️ ${label(u)} held the line${tgt ? ` — ${elabel(tgt)} down` : ""}`, "good");
        else if (u.role === "scout") pushFeed(`🔍 ${label(u)} slipped through${tgt ? ` — ${elabel(tgt)} down` : ""}`, "good");
        else pushFeed(`⚔️ ${label(u)} slew ${tgt ? elabel(tgt) : "an enemy"}`, "good");
      } else {
        u.hit = 1; if (tgt) { tgt.flash = 1; }
        kill(u, "fell");
        pushFeed(`☠ ${label(u)} fell to ${tgt ? elabel(tgt) : `the ${enemy.name}`}`, "bad");
      }
    };

    const update = (dtMs: number) => {
      const sp = speedRef.current;
      // slow-mo on the last ant's impact window
      const lastA = actStart(N - 1); const inFinaleWindow = t > lastA + STEP * 0.35 && t < lastA + STEP * 0.95;
      const scale = sp > 1 ? sp : inFinaleWindow ? 0.38 : 1;
      const dt = (dtMs * scale) / 1000; t += dtMs * scale;

      // march-in
      if (t < MARCH) { const p = ease(clamp01(t / MARCH)); for (const u of units) { u.x = u.x + (u.homeX - u.x) * Math.min(1, dt * (3 + p * 4)); } }

      // acts
      for (let i = 0; i < N; i++) {
        const a = acts[i], u = allies[i], s = slots[i]; const st = actStart(i); if (t < st) break;
        const p = clamp01((t - st) / STEP);
        if (!a.started) {
          a.started = true; a.target = nearestEnemy(u);
          setHud(h => ({ ...h, current: i + 1, phase: "BATTLE" }));
          if (a.target) { a.target.tx = W * 0.5 + 34; a.target.ty = u.y; }
          // charge destination
          if (u.role === "carrier") { u.tx = W * 0.86; u.ty = u.y; }
          else if (u.role === "scout") { u.tx = W * 0.5 + 10; u.ty = groundTop() - 6 + (i % 2) * 8; }
          else if (u.role === "bomber") { u.tx = W * 0.62; u.ty = a.target ? a.target.y : u.y; }
          else { u.tx = W * 0.5 - 30; u.ty = u.y; }
          u.speed = u.role === "scout" ? 2.1 : u.role === "carrier" ? 1.5 : 1.35;
          focusTX = (u.x + (a.target?.x ?? W * 0.6)) / 2; focusTY = u.y; zoomTarget = 1.06;
        }
        if (!a.impact && p >= 0.55) {
          a.impact = true; doImpact(i);
        }
        if (!a.resolved && p >= 0.75) {
          a.resolved = true; u.resolved = true;
          const surv = !!s.survived;
          if (surv) {
            if (u.role === "carrier") { u.tx = -80; u.ty = u.y; u.fled = true; carriersHome++; }
            else if (u.role === "scout") { u.tx = W + 80; u.fled = true; }
            else { u.tx = W * 0.5 - 40 - (i % 3) * 18; u.ty = u.homeY; }
          }
          setHud(h => ({ ...h, allyAlive: allies.filter(x => x.alive).length, enemyAlive: enemies.filter(x => x.alive).length, carriersHome }));
          cbRef.current.onUnitResolved?.(i, surv);
        }
      }

      // finale
      if (t > battleEnd && !finaleShown) { finaleShown = true; zoomTarget = 1; focusTX = W / 2; focusTY = H * 0.62; setHud(h => ({ ...h, phase: "FINALE", done: true })); }
      if (t > battleEnd + FINALE && !completed) { completed = true; cbRef.current.onComplete?.(); }

      // movement
      for (const u of units) {
        if (!u.alive) { u.dying = Math.min(1, u.dying + dt * 2.2); continue; }
        const k = Math.min(1, dt * 2.6 * u.speed);
        u.x += (u.tx - u.x) * k; u.y += (u.ty - u.y) * k;
        u.bob += dt * (Math.abs(u.tx - u.x) > 4 ? 14 : 4);
        u.flash = Math.max(0, u.flash - dt * 3); u.hit = Math.max(0, u.hit - dt * 3);
      }
      // idle enemies drift back home slowly
      for (const e of enemies) if (e.alive && e.tx !== e.homeX && !allies.some((_a, i) => acts[i].target === e && !acts[i].resolved)) { e.tx = e.homeX; e.ty = e.homeY; }

      // particles
      for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.life += dt; if (p.life > p.max) { particles.splice(i, 1); continue; } p.vy += p.grav * dt; p.x += p.vx * 60 * dt; p.y += p.vy * 60 * dt; }
      // camera
      shake = Math.max(0, shake - dt * 22);
      zoom += (zoomTarget - zoom) * Math.min(1, dt * 3); focusX += (focusTX - focusX) * Math.min(1, dt * 3); focusY += (focusTY - focusY) * Math.min(1, dt * 3);
    };

    const drawUnit = (u: Unit) => {
      const s = unitScale() * (u.side === "enemy" ? 0.98 : 1);
      const size = SPRITE_PX * s * 0.62;
      const spr = sprites[(u.side === "ally" ? "ally_" : "enemy_") + u.role];
      ctx.save();
      const bobY = u.alive ? Math.sin(u.bob) * 2.2 : 0;
      ctx.translate(u.x, u.y + bobY);
      // shadow
      ctx.globalAlpha = u.alive ? 0.45 : 0.25; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(0, size * 0.5, size * 0.36, size * 0.11, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      if (!u.alive) { const d = ease(u.dying); ctx.rotate((u.side === "ally" ? 1 : -1) * d * Math.PI / 2 * (u.flip ? -1 : 1)); ctx.translate(0, d * size * 0.25); ctx.globalAlpha = 1 - d * 0.62; ctx.filter = `grayscale(${d}) brightness(${1 - d * 0.55})`; }
      if (u.flip) ctx.scale(-1, 1);
      if (u.boosted && u.alive) { ctx.shadowColor = "rgba(244,114,182,0.95)"; ctx.shadowBlur = 16; }
      if (u.flash > 0 && u.alive) { ctx.shadowColor = u.side === "ally" ? faction.colors.glow : enemy.colors.glow; ctx.shadowBlur = 24 * u.flash; }
      if (spr) ctx.drawImage(spr, -size / 2, -size / 2, size, size);
      else { ctx.font = `${size * 0.6}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(ROLE_EMOJI[u.role], 0, 0); }
      if (u.hit > 0 && u.alive) { ctx.globalCompositeOperation = "source-atop"; ctx.fillStyle = `rgba(255,60,60,${u.hit * 0.6})`; ctx.fillRect(-size / 2, -size / 2, size, size); ctx.globalCompositeOperation = "source-over"; }
      ctx.restore();
      // carried loot
      if (u.carrying && u.alive) { ctx.save(); ctx.translate(u.x, u.y - size * 0.5); ctx.font = `${Math.max(12, size * 0.28)}px serif`; ctx.textAlign = "center"; ctx.shadowColor = "rgba(251,191,36,1)"; ctx.shadowBlur = 14; ctx.fillText("📦", 0, 0); ctx.restore(); }
      // number tag (allies)
      if (u.side === "ally" && u.alive) { ctx.save(); ctx.font = `700 ${Math.max(8, size * 0.16)}px monospace`; ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillText(String(u.slotIdx + 1), u.x, u.y + size * 0.62); ctx.restore(); }
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // background
      if (bgReady) {
        const ar = bg.width / bg.height; let bw = W * 1.15, bh = bw / ar; if (bh < H * 1.15) { bh = H * 1.15; bw = bh * ar; }
        const par = (focusX - W / 2) * 0.06;
        ctx.drawImage(bg, (W - bw) / 2 - par, (H - bh) / 2 - H * 0.05, bw, bh);
      } else { ctx.fillStyle = "#0a1226"; ctx.fillRect(0, 0, W, H); }
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(2,6,23,0.55)"); g.addColorStop(0.45, "rgba(2,6,23,0.25)"); g.addColorStop(1, "rgba(2,6,23,0.9)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // side tints
      const lg = ctx.createLinearGradient(0, 0, W, 0); lg.addColorStop(0, faction.colors.glow.replace(/[\d.]+\)$/, "0.22)")); lg.addColorStop(0.45, "rgba(0,0,0,0)"); lg.addColorStop(0.55, "rgba(0,0,0,0)"); lg.addColorStop(1, enemy.colors.glow.replace(/[\d.]+\)$/, "0.22)")); ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);

      // camera
      ctx.save();
      const sx = (rand() - 0.5) * shake, sy = (rand() - 0.5) * shake;
      ctx.translate(W / 2 + sx, H * 0.62 + sy); ctx.scale(zoom, zoom); ctx.translate(-focusX, -focusY);

      // loot pile (enemy side)
      ctx.save(); ctx.translate(W * 0.88, groundBot() - 10); ctx.font = `${Math.max(18, unitScale() * 52)}px serif`; ctx.textAlign = "center"; ctx.shadowColor = "rgba(251,191,36,0.9)"; ctx.shadowBlur = 18; ctx.fillText("📦", 0, 0); ctx.fillText("📦", -18, 8); ctx.fillText("📦", 16, 10); ctx.restore();
      // clash line
      ctx.save(); ctx.strokeStyle = "rgba(253,224,71,0.12)"; ctx.setLineDash([6, 10]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(W / 2, groundTop() - 20); ctx.lineTo(W / 2, groundBot() + 10); ctx.stroke(); ctx.restore();

      // units sorted by y (depth), dead first
      const sorted = [...units].sort((a, b) => (a.alive === b.alive ? a.y - b.y : a.alive ? 1 : -1));
      for (const u of sorted) drawUnit(u);

      // particles
      for (const p of particles) { const a = 1 - p.life / p.max; ctx.globalAlpha = a * (p.kind === "smoke" ? 0.5 : 1); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.kind === "smoke" ? 1 + p.life * 3 : a), 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      ctx.restore();

      // vignette
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, W * 0.75); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.55)"); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      // finale flash text drawn by DOM overlay
    };

    let raf = 0;
    const loop = (now: number) => {
      if (disposed) return;
      const dtMs = Math.min(50, now - last); last = now;
      update(dtMs); draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { disposed = true; cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const FONT = "'Noto Serif JP', 'Hiragino Mincho ProN', serif";
  const survivors = slots.filter(s => s.survived).length;
  const carriers = slots.filter(s => s.role === "carrier" && s.survived).length;
  const finaleTitle = hud.done ? (survivors >= Math.ceil(slots.length * 0.65) && carriers >= 4 ? "LEGENDARY HAUL" : survivors >= Math.ceil(slots.length * 0.4) && carriers >= 1 ? "RAID SUCCESSFUL" : survivors >= 5 ? "CRATE SECURED" : "ROUTED") : "";
  const finaleColor = finaleTitle === "LEGENDARY HAUL" ? "#fbbf24" : finaleTitle === "RAID SUCCESSFUL" ? "#60a5fa" : finaleTitle === "CRATE SECURED" ? "#34d399" : "#f87171";

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", borderRadius: 16, overflow: "hidden", background: "#050a16", border: `1px solid ${faction.colors.primary}44`, boxShadow: `0 0 40px ${faction.colors.glow.replace(/[\d.]+\)$/, "0.18)")}` }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: H }} />

      {/* top HUD */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", fontFamily: FONT, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "#cbd5e1", background: `linear-gradient(90deg, ${faction.colors.glow.replace(/[\d.]+\)$/, "0.35)")}, rgba(0,0,0,0.35) 45%, rgba(0,0,0,0.35) 55%, ${enemy.colors.glow.replace(/[\d.]+\)$/, "0.35)")})`, pointerEvents: "none" }}>
        <span><b style={{ color: faction.colors.text }}>{faction.name}</b> · {hud.allyAlive}/{slots.length} alive · 🎒 {hud.carriersHome}</span>
        <span style={{ color: "#fde68a", fontWeight: 900 }}>{hud.phase === "MARCH" ? "⚔ MARCHING" : hud.phase === "BATTLE" ? `ANT ${hud.current} / ${slots.length}` : "⚔ BATTLE OVER"}</span>
        <span>{hud.enemyAlive}/{slots.length} alive · <b style={{ color: enemy.colors.text }}>{enemy.name}</b></span>
      </div>

      {/* strength bars */}
      <div style={{ position: "absolute", top: 34, left: 12, right: 12, display: "flex", gap: 8, pointerEvents: "none" }}>
        <div style={{ flex: 1, height: 4, background: "rgba(0,0,0,0.6)", borderRadius: 2, overflow: "hidden" }}><div style={{ width: `${(hud.allyAlive / slots.length) * 100}%`, height: "100%", background: faction.colors.primary, transition: "width .4s" }} /></div>
        <div style={{ flex: 1, height: 4, background: "rgba(0,0,0,0.6)", borderRadius: 2, overflow: "hidden", display: "flex", justifyContent: "flex-end" }}><div style={{ width: `${(hud.enemyAlive / slots.length) * 100}%`, height: "100%", background: enemy.colors.primary, transition: "width .4s" }} /></div>
      </div>

      {/* skip / speed */}
      {!hud.done && (
        <button type="button" onClick={() => setSpeed(s => (s === 1 ? 4 : 1))}
          style={{ position: "absolute", top: 44, right: 10, fontFamily: FONT, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", padding: "5px 10px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.25)", background: speed > 1 ? "rgba(253,224,71,0.2)" : "rgba(0,0,0,0.55)", color: speed > 1 ? "#fde68a" : "rgba(255,255,255,0.75)", cursor: "pointer" }}>
          {speed > 1 ? "⏩ 4× — NORMAL" : "⏩ SKIP"}
        </button>
      )}

      {/* finale banner */}
      {hud.done && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", animation: "raidBannerIn .6s cubic-bezier(.2,.9,.3,1.2) both" }}>
          <div style={{ fontFamily: FONT, fontSize: "clamp(22px,4.5vw,44px)", fontWeight: 900, letterSpacing: "0.3em", textTransform: "uppercase", color: finaleColor, textShadow: `0 0 30px ${finaleColor}, 0 0 60px ${finaleColor}66`, padding: "10px 26px", border: `1px solid ${finaleColor}66`, borderRadius: 999, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}>
            {finaleTitle}
          </div>
        </div>
      )}

      {/* kill feed */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "6px 12px 8px", background: "linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.75))", pointerEvents: "none", display: "flex", flexDirection: "column", gap: 2 }}>
        {feed.slice(-3).map((f, i, arr) => (
          <div key={f.id} style={{ fontFamily: FONT, fontSize: 11, letterSpacing: "0.04em", color: f.tone === "good" ? "#86efac" : f.tone === "boom" ? "#fdba74" : "#fca5a5", opacity: 0.45 + (i + 1) / arr.length * 0.55, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.text}</div>
        ))}
      </div>
      <style>{`@keyframes raidBannerIn{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}
