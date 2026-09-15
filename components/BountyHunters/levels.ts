// components/BountyHunters/levels.ts
// Deterministic segment-based board builder. 14 rows × N columns of tiles, plus spawn markers.
// Tile ids: 0 empty · 1 solid · 2 one-way platform · 3 spikes · 8 decoration · 10 goal flag
import type { Board } from "../../lib/bountyConfig";

export const ROWS = 14;
export const TILE = 16;

export type Spawn = { kind: "grunt" | "elite" | "wasp" | "turret" | "crate" | "boss" | "heart"; x: number; y: number };
export type Level = { cols: number; tiles: Uint8Array; spawns: Spawn[]; startX: number; bossX: number; endX: number };

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; }; }

export function buildLevel(board: Board): Level {
  const cols = board.length; const t = new Uint8Array(cols * ROWS); const spawns: Spawn[] = [];
  const r = rng(board.n * 7919 + 13);
  const set = (x: number, y: number, v: number) => { if (x >= 0 && x < cols && y >= 0 && y < ROWS) t[y * cols + x] = v; };
  const get = (x: number, y: number) => (x >= 0 && x < cols && y >= 0 && y < ROWS ? t[y * cols + x] : 1);
  const column = (x: number, groundY: number) => { for (let y = groundY; y < ROWS; y++) set(x, y, 1); };
  const d = board.difficulty;

  // safe start: 14 cols of flat ground
  let x = 0; let ground = 11;
  for (; x < 22; x++) column(x, ground);
  const startX = 3 * TILE;

  const bossArenaW = 28;
  while (x < cols - bossArenaW - 6) {
    const pick = r();
    if (pick < 0.30) {              // flat run with enemies + a crate
      const len = 8 + Math.floor(r() * 8);
      for (let i = 0; i < len; i++) column(x + i, ground);
      const n = 1 + Math.floor(r() * (1 + d * 0.6));
      for (let i = 0; i < n; i++) spawns.push({ kind: r() < 0.25 + d * 0.08 ? "elite" : "grunt", x: (x + 3 + Math.floor(r() * (len - 4))) * TILE, y: (ground - 1) * TILE });
      if (r() < 0.5) spawns.push({ kind: "crate", x: (x + 1 + Math.floor(r() * (len - 2))) * TILE, y: (ground - 1) * TILE });
      if (r() < 0.35) set(x + Math.floor(len / 2), ground - 1, 8);
      x += len;
    } else if (pick < 0.48) {       // pit with spikes (2-4 wide) — jumpable
      const w = 2 + Math.floor(r() * Math.min(3, 1 + d));
      for (let i = 0; i < w; i++) { for (let y = ground; y < ROWS; y++) set(x + i, y, y === ROWS - 1 ? 3 : 0); }
      if (w >= 4) { set(x + 1, ground - 2, 2); set(x + 2, ground - 2, 2); }
      x += w;
      for (let i = 0; i < 3; i++) column(x + i, ground);
      x += 3;
    } else if (pick < 0.66) {       // stairs of platforms up, wasps above
      const len = 10 + Math.floor(r() * 6);
      for (let i = 0; i < len; i++) column(x + i, ground);
      const steps = 2 + Math.floor(r() * 2);
      for (let s = 0; s < steps; s++) { const px = x + 2 + s * 3, py = ground - 3 - s * 2; for (let i = 0; i < 3; i++) set(px + i, py, 2); if (s === steps - 1 && r() < 0.6) spawns.push({ kind: "crate", x: (px + 1) * TILE, y: (py - 1) * TILE }); }
      for (let i = 0; i < 1 + Math.floor(d / 2); i++) spawns.push({ kind: "wasp", x: (x + 4 + Math.floor(r() * (len - 6))) * TILE, y: (3 + Math.floor(r() * 3)) * TILE });
      if (r() < 0.5) spawns.push({ kind: "grunt", x: (x + len - 3) * TILE, y: (ground - 1) * TILE });
      x += len;
    } else if (pick < 0.82) {       // raised block with a turret on top
      const len = 9 + Math.floor(r() * 5); const h = 2 + Math.floor(r() * 2);
      for (let i = 0; i < 3; i++) column(x + i, ground);
      x += 3;
      for (let i = 0; i < len; i++) column(x + i, ground - h);
      spawns.push({ kind: "turret", x: (x + Math.floor(len / 2)) * TILE, y: (ground - h - 2) * TILE });
      if (r() < 0.6) spawns.push({ kind: "grunt", x: (x + len - 2) * TILE, y: (ground - h - 1) * TILE });
      x += len;
      for (let i = 0; i < 3; i++) column(x + i, ground);
      x += 3;
    } else {                        // ground level change (ramp) with a heart sometimes
      const nh = 9 + Math.floor(r() * 4); // 9..12
      const len = 6;
      for (let i = 0; i < len; i++) column(x + i, ground);
      if (Math.abs(nh - ground) >= 3) { set(x + len - 2, Math.min(nh, ground) + 1, 2); }
      x += len; ground = nh;
      for (let i = 0; i < 4; i++) column(x + i, ground);
      if (r() < 0.25) spawns.push({ kind: "heart", x: (x + 2) * TILE, y: (ground - 1) * TILE });
      x += 4;
    }
  }
  // approach + boss arena: flat, walls at both ends, boss on the right
  for (; x < cols - bossArenaW; x++) column(x, ground);
  const arenaStart = x; const arenaGround = 11;
  for (; x < cols; x++) column(x, arenaGround);
  for (let y = 0; y < arenaGround; y++) set(cols - 1, y, 1);
  set(arenaStart + 4, arenaGround - 3, 2); set(arenaStart + 5, arenaGround - 3, 2); set(arenaStart + 6, arenaGround - 3, 2);
  set(cols - 8, arenaGround - 3, 2); set(cols - 7, arenaGround - 3, 2); set(cols - 6, arenaGround - 3, 2);
  spawns.push({ kind: "boss", x: (cols - 8) * TILE, y: (arenaGround - 4) * TILE });
  spawns.push({ kind: "crate", x: (arenaStart + 2) * TILE, y: (arenaGround - 1) * TILE });
  const bossX = (arenaStart + 2) * TILE;          // camera locks here
  set(arenaStart + 1, arenaGround - 1, 10);       // "wanted" flag marks the arena

  // decorations on random ground tops
  for (let cx = 14; cx < cols - bossArenaW; cx++) { for (let y = 1; y < ROWS; y++) { if (get(cx, y) === 1 && get(cx, y - 1) === 0 && r() < 0.08) set(cx, y - 1, 8); } }
  return { cols, tiles: t, spawns, startX, bossX, endX: cols * TILE };
}
