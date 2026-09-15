// components/BountyHunters/levels.ts
// Deterministic segment-based board builder. 14 rows × N columns of tiles, plus spawn markers.
// Tile ids: 0 empty · 1 solid · 2 one-way platform · 3 spikes · 8 decoration · 10 wanted flag · 11 timed spikes (phase A) · 12 timed spikes (phase B)
import type { Board } from "../../lib/bountyConfig";

export const ROWS = 14;
export const TILE = 16;

export type SpawnKind = "grunt" | "elite" | "wasp" | "turret" | "hopper" | "crate" | "boss" | "heart" | "mplat" | "crumble" | "crusher" | "spring" | "cannon" | "brick";
export type Spawn = { kind: SpawnKind; x: number; y: number; data?: any };
export type Level = { cols: number; tiles: Uint8Array; spawns: Spawn[]; startX: number; bossX: number; endX: number };

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; }; }

export function buildLevel(board: Board): Level {
  const cols = board.length; const t = new Uint8Array(cols * ROWS); const spawns: Spawn[] = [];
  const r = rng(board.n * 7919 + 13);
  const set = (x: number, y: number, v: number) => { if (x >= 0 && x < cols && y >= 0 && y < ROWS) t[y * cols + x] = v; };
  const get = (x: number, y: number) => (x >= 0 && x < cols && y >= 0 && y < ROWS ? t[y * cols + x] : 1);
  const column = (x: number, groundY: number) => { for (let y = groundY; y < ROWS; y++) set(x, y, 1); };
  const pit = (x: number, w: number, hazard = 3) => { for (let i = 0; i < w; i++) for (let y = 0; y < ROWS; y++) set(x + i, y, y === ROWS - 1 ? hazard : 0); };
  const d = board.difficulty;                   // 1..12
  const w = board.world;                        // 1..4
  const enemyKind = () => (r() < 0.2 + d * 0.04 ? "elite" : "grunt") as SpawnKind;
  const spawnEnemies = (x: number, len: number, ground: number, n: number) => { for (let i = 0; i < n; i++) spawns.push({ kind: enemyKind(), x: (x + 2 + Math.floor(r() * Math.max(1, len - 4))) * TILE, y: (ground - 1) * TILE }); };

  // safe start
  let x = 0; let ground = 11;
  for (; x < 20; x++) column(x, ground);
  const startX = 3 * TILE;

  // segment menu grows with difficulty
  type Seg = () => void;
  const segs: { w: number; f: Seg }[] = [];
  const add = (weight: number, f: Seg) => segs.push({ w: weight, f });

  add(3, () => {                                            // flat run with enemies + crate
    const len = 8 + Math.floor(r() * 8);
    for (let i = 0; i < len; i++) column(x + i, ground);
    spawnEnemies(x, len, ground, 1 + Math.floor(r() * (1 + d * 0.25)));
    if (r() < 0.5) spawns.push({ kind: "crate", x: (x + 1 + Math.floor(r() * (len - 2))) * TILE, y: (ground - 1) * TILE });
    x += len;
  });
  add(2, () => {                                            // spike / acid pit, jumpable (2–4 wide)
    const pw = 2 + Math.floor(r() * Math.min(3, 1 + d / 3));
    pit(x, pw); if (pw >= 4) { set(x + 1, ground - 2, 2); set(x + 2, ground - 2, 2); }
    x += pw; for (let i = 0; i < 3; i++) column(x + i, ground); x += 3;
  });
  add(2, () => {                                            // platform stairs + wasps
    const len = 10 + Math.floor(r() * 6);
    for (let i = 0; i < len; i++) column(x + i, ground);
    const steps = 2 + Math.floor(r() * 2);
    for (let s = 0; s < steps; s++) { const px = x + 2 + s * 3, py = ground - 3 - s * 2; for (let i = 0; i < 3; i++) set(px + i, py, 2); if (s === steps - 1 && r() < 0.6) spawns.push({ kind: "crate", x: (px + 1) * TILE, y: (py - 1) * TILE }); }
    for (let i = 0; i < 1 + Math.floor(d / 4); i++) spawns.push({ kind: "wasp", x: (x + 4 + Math.floor(r() * (len - 6))) * TILE, y: (3 + Math.floor(r() * 3)) * TILE });
    if (r() < 0.5) spawns.push({ kind: enemyKind(), x: (x + len - 3) * TILE, y: (ground - 1) * TILE });
    x += len;
  });
  add(2, () => {                                            // raised block with a turret
    const len = 9 + Math.floor(r() * 5); const h = 2 + Math.floor(r() * 2);
    for (let i = 0; i < 3; i++) column(x + i, ground); x += 3;
    for (let i = 0; i < len; i++) column(x + i, ground - h);
    spawns.push({ kind: "turret", x: (x + Math.floor(len / 2)) * TILE, y: (ground - h - 2) * TILE });
    if (r() < 0.6) spawns.push({ kind: enemyKind(), x: (x + len - 2) * TILE, y: (ground - h - 1) * TILE });
    x += len; for (let i = 0; i < 3; i++) column(x + i, ground); x += 3;
  });
  add(1.5, () => {                                          // ground level change, sometimes a heart
    const nh = 9 + Math.floor(r() * 4); const len = 6;
    for (let i = 0; i < len; i++) column(x + i, ground);
    if (Math.abs(nh - ground) >= 3) set(x + len - 2, Math.min(nh, ground) + 1, 2);
    x += len; ground = nh; for (let i = 0; i < 4; i++) column(x + i, ground);
    if (r() < 0.25) spawns.push({ kind: "heart", x: (x + 2) * TILE, y: (ground - 1) * TILE });
    x += 4;
  });
  if (d >= 2) add(2.5, () => {                              // moving platforms over a wide pit
    const pw = 6 + Math.floor(r() * 4); pit(x, pw);
    const vertical = d >= 5 && r() < 0.4;
    if (vertical) { spawns.push({ kind: "mplat", x: (x + Math.floor(pw / 2) - 1) * TILE, y: (ground - 2) * TILE, data: { dx: 0, dy: 56, period: 3.2, w: 2 } }); }
    else { const n = pw > 8 ? 2 : 1; for (let i = 0; i < n; i++) spawns.push({ kind: "mplat", x: (x + 1 + i * Math.floor(pw / 2)) * TILE, y: (ground - 1 - i) * TILE, data: { dx: (pw - 3) * TILE / n, dy: 0, period: 2.6 - d * 0.06, w: 2, phase: i * 0.5 } }); }
    x += pw; for (let i = 0; i < 3; i++) column(x + i, ground); x += 3;
  });
  if (d >= 3) add(2, () => {                                // crumble bridge
    const pw = 5 + Math.floor(r() * 5); pit(x, pw);
    for (let i = 0; i < pw; i += 2) spawns.push({ kind: "crumble", x: (x + i) * TILE, y: (ground - 1) * TILE, data: { w: 2 } });
    x += pw; for (let i = 0; i < 3; i++) column(x + i, ground); x += 3;
  });
  if (d >= 4) add(2, () => {                                // crusher hall: ceiling with 2–3 slamming blocks
    const len = 12 + Math.floor(r() * 6);
    for (let i = 0; i < len; i++) { column(x + i, ground); for (let y = 0; y <= ground - 7; y++) set(x + i, y, 1); }
    const n = 2 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) spawns.push({ kind: "crusher", x: (x + 3 + Math.floor(i * (len - 6) / Math.max(1, n - 1))) * TILE, y: (ground - 6) * TILE, data: { drop: (ground - 6 - (ground - 6)) * 0 + 4 * TILE, period: 2.4 - d * 0.05, phase: i * 0.7 } });
    x += len;
  });
  if (d >= 3) add(1.5, () => {                              // spring over a tall wall
    for (let i = 0; i < 4; i++) column(x + i, ground);
    spawns.push({ kind: "spring", x: (x + 2) * TILE, y: (ground - 1) * TILE });
    x += 4; const wh = 5 + Math.floor(r() * 2); for (let i = 0; i < 3; i++) column(x + i, ground - wh);
    if (r() < 0.6) spawns.push({ kind: "crate", x: (x + 1) * TILE, y: (ground - wh - 1) * TILE });
    x += 3; for (let i = 0; i < 3; i++) column(x + i, ground); x += 3;
  });
  if (d >= 5) add(2, () => {                                // cannon alley: pillars with cannons firing across a low run
    const len = 12 + Math.floor(r() * 5);
    for (let i = 0; i < len; i++) column(x + i, ground);
    const n = 2 + Math.floor(d / 5);
    for (let i = 0; i < n; i++) { const px = x + 2 + Math.floor(i * (len - 4) / n); const ph = 2 + (i % 2); for (let y = ground - ph; y < ground; y++) set(px, y, 1); spawns.push({ kind: "cannon", x: px * TILE, y: (ground - ph - 1) * TILE, data: { dir: i % 2 ? -1 : 1, period: 2.2 - d * 0.05, phase: i * 0.6 } }); }
    x += len;
  });
  if (d >= 2) add(1.5, () => {                              // brick wall to shoot through, tags inside
    for (let i = 0; i < 3; i++) column(x + i, ground); x += 3;
    const h = 2 + Math.floor(r() * 2);
    for (let i = 0; i < 2; i++) { column(x + i, ground); for (let y = ground - h; y < ground; y++) spawns.push({ kind: "brick", x: (x + i) * TILE, y: y * TILE }); }
    x += 2; for (let i = 0; i < 3; i++) column(x + i, ground); x += 3;
  });
  if (d >= 4) add(2, () => {                                // timed spike corridor
    const len = 8 + Math.floor(r() * 6);
    for (let i = 0; i < len; i++) { column(x + i, ground); if (i >= 2 && i < len - 2 && i % 3 !== 0) set(x + i, ground - 1, (Math.floor(i / 3) % 2) ? 12 : 11); }
    x += len;
  });
  if (d >= 3) add(2, () => {                                // hopper nest
    const len = 9 + Math.floor(r() * 5);
    for (let i = 0; i < len; i++) column(x + i, ground);
    for (let i = 0; i < 2 + Math.floor(d / 4); i++) spawns.push({ kind: "hopper", x: (x + 2 + Math.floor(r() * (len - 4))) * TILE, y: (ground - 2) * TILE });
    x += len;
  });

  const total = segs.reduce((s, q) => s + q.w, 0);
  const bossArenaW = 28;
  let guard = 0;
  while (x < cols - bossArenaW - 6 && guard++ < 400) {
    let pick = r() * total; let seg = segs[0];
    for (const q of segs) { pick -= q.w; if (pick <= 0) { seg = q; break; } }
    seg.f();
  }
  // approach + boss arena
  for (; x < cols - bossArenaW; x++) column(x, ground);
  const arenaStart = x; const arenaGround = 11;
  for (; x < cols; x++) column(x, arenaGround);
  for (let y = 0; y < arenaGround; y++) set(cols - 1, y, 1);
  set(arenaStart + 4, arenaGround - 3, 2); set(arenaStart + 5, arenaGround - 3, 2); set(arenaStart + 6, arenaGround - 3, 2);
  set(cols - 8, arenaGround - 3, 2); set(cols - 7, arenaGround - 3, 2); set(cols - 6, arenaGround - 3, 2);
  spawns.push({ kind: "boss", x: (cols - 8) * TILE, y: (arenaGround - 4) * TILE });
  spawns.push({ kind: "crate", x: (arenaStart + 2) * TILE, y: (arenaGround - 1) * TILE });
  const bossX = (arenaStart + 2) * TILE;
  set(arenaStart + 1, arenaGround - 1, 10);

  // decorations on ground tops
  for (let cx = 14; cx < cols - bossArenaW; cx++) { for (let y = 1; y < ROWS; y++) { if (get(cx, y) === 1 && get(cx, y - 1) === 0 && r() < 0.08) set(cx, y - 1, 8); } }
  return { cols, tiles: t, spawns, startX, bossX, endX: cols * TILE };
}
