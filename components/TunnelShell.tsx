import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePoints } from "../lib/usePoints";
import { loadProfile, getEffectivePlayerId, saveProfile } from "../lib/profile";

// ── Audio system ──────────────────────────────────────────────────────────────
function useAudio() {
  const [muted, setMuted] = React.useState<boolean>(() => {
    try { return localStorage.getItem("ra:tunnel:muted") === "1"; } catch { return false; }
  });
  const mutedRef = React.useRef(muted);
  mutedRef.current = muted;
  const ambientRef = React.useRef<HTMLAudioElement | null>(null);

  const play = React.useCallback((src: string, volume = 1) => {
    if (typeof window === "undefined") return;
    try {
      const a = new Audio(src);
      a.volume = volume;
      void a.play().catch(() => {});
    } catch {}
  }, []);

  const startAmbient = React.useCallback(() => {
    if (typeof window === "undefined") return;
    if (ambientRef.current) { ambientRef.current.pause(); ambientRef.current = null; }
    try {
      const a = new Audio("/audio/ambient-tunnel.mp3");
      a.loop = true;
      a.volume = mutedRef.current ? 0 : 0.35;
      void a.play().catch(() => {});
      ambientRef.current = a;
    } catch {}
  }, [muted]);

  const stopAmbient = React.useCallback(() => {
    if (ambientRef.current) {
      ambientRef.current.pause();
      ambientRef.current.currentTime = 0;
      ambientRef.current = null;
    }
  }, []);

  const toggleMute = React.useCallback(() => {
    setMuted(m => {
      const next = !m;
      try { localStorage.setItem("ra:tunnel:muted", next ? "1" : "0"); } catch {}
      if (ambientRef.current) ambientRef.current.volume = next ? 0 : 0.35;
      return next;
    });
  }, []);

  const sfx = React.useMemo(() => ({
    crumb:   () => { if (!mutedRef.current) play("/audio/collect-crumb.mp3",   0.1); },
    crystal: () => { if (!mutedRef.current) play("/audio/collect-crystal.mp3", 1.0); },
    sugar:   () => { if (!mutedRef.current) play("/audio/collect-crumb.mp3",   0.1); },
    wall:    () => { if (!mutedRef.current) play("/audio/wall-break.mp3",      0.75); },
    win:     () => { if (!mutedRef.current) { stopAmbient(); play("/audio/tunnel-win.mp3", 0.9); } },
    lose:    () => { if (!mutedRef.current) { stopAmbient(); play("/audio/tunnel-lose.mp3", 0.8); } },
    spiderHit: () => { if (!mutedRef.current) play("/audio/spider-hit.mp3", 0.6); },
  }), [play, stopAmbient]);

  return { muted, toggleMute, startAmbient, stopAmbient, sfx };
}
import BuyPointsModal from "./BuyPointsModal";
import SharedEconomyPanel from "./SharedEconomyPanel";

type Cell = { row: number; col: number };
type Facing = "up" | "down" | "left" | "right";
type BoardTheme = "colony" | "neon" | "mythic" | "lava" | "ice" | "golden" | "shadow" | "amber" | "toxic" | "void";
type PickupBurst = {
  id: number;
  row: number;
  col: number;
  kind: "crumb" | "sugar" | "crystal";
};

type WallBurst = {
  id: number;
  row: number;
  col: number;
};

type TunnelScoreRow = {
  rank: number;
  playerId: string;
  playerName: string;
  score: number;
};

type TunnelFastestRow = {
  rank: number;
  playerId: string;
  playerName: string;
  clearTimeMs: number;
};

type TunnelPersonalStats = {
  playerId: string;
  playerName: string;
  bestScore: number;
  bestClearTimeMs: number;
  totalRuns: number;
  totalCrystals: number;
};

const GRID_ROWS = 14;
const GRID_COLS = 22;

const DEFAULT_TUNNEL_CONFIG = {
  currency: "REBEL",
  dailyClaim: 200,
  tunnelCost: 50,
  tunnelRunSeconds: 60,
  tunnelCrystalCount: 8,
  tunnelSugarCount: 18,
  tunnelCrumbCount: 95,
  tunnelWallBreaks: 5,
  tunnelSpiderSpeedMs: 160,
};

const START_CELL: Cell = { row: 2, col: 2 };

const themeMap: Record<string, any> = {
  colony: {
    name: "Colony Tunnel",
    bg: "linear-gradient(180deg, rgba(16,24,39,0.14), rgba(0,0,0,0.24)), linear-gradient(135deg, #2d1f14, #1b130d)",
    floor: "rgba(255,255,255,0.04)",
    wall: "linear-gradient(135deg, rgba(91,62,38,0.96), rgba(52,35,23,0.98))",
    accent: "#60a5fa",
    crumb: "rgba(245, 222, 179, 0.98)",
    sugar: "rgba(250, 204, 21, 0.98)",
    crystal: "rgba(96, 165, 250, 0.98)",
    antGlow: "0 0 26px rgba(96,165,250,0.30)",
    spiderGlow: "0 0 22px rgba(239,68,68,0.26)",
  },
  neon: {
    name: "Neon Sci-Fi Tunnel",
    bg: "linear-gradient(180deg, rgba(3,7,18,0.18), rgba(0,0,0,0.30)), linear-gradient(135deg, #09111d, #111827)",
    floor: "rgba(34,211,238,0.06)",
    wall: "linear-gradient(135deg, rgba(17,24,39,0.98), rgba(8,15,28,0.98))",
    accent: "#22d3ee",
    crumb: "rgba(165, 243, 252, 0.98)",
    sugar: "rgba(45, 212, 191, 0.98)",
    crystal: "rgba(244, 114, 182, 0.98)",
    antGlow: "0 0 26px rgba(34,211,238,0.32)",
    spiderGlow: "0 0 22px rgba(244,114,182,0.26)",
  },
  mythic: {
    name: "Dark Mythic Colony",
    bg: "linear-gradient(180deg, rgba(10,10,15,0.20), rgba(0,0,0,0.36)), linear-gradient(135deg, #1a0f12, #120b0d)",
    floor: "rgba(255,255,255,0.03)",
    wall: "linear-gradient(135deg, rgba(45,16,24,0.98), rgba(24,10,14,0.98))",
    accent: "#f43f5e",
    crumb: "rgba(254, 215, 170, 0.98)",
    sugar: "rgba(251, 191, 36, 0.98)",
    crystal: "rgba(244, 63, 94, 0.98)",
    antGlow: "0 0 26px rgba(244,63,94,0.28)",
    spiderGlow: "0 0 22px rgba(251,191,36,0.22)",
  },
  lava:   { name:"Lava Caves",   bg:"#1a0500",floor:"#2d0a00",wall:"#8b1a00",accent:"#ff4500",crumb:"#ff6b35",sugar:"#ff8c00",crystal:"#ffcc00",antGlow:"#ff4500",spiderGlow:"#ff0000",neon:false },
  ice:    { name:"Ice Caverns",  bg:"#000d1a",floor:"#001a33",wall:"#003366",accent:"#00ccff",crumb:"#80e5ff",sugar:"#ffffff",crystal:"#00ffff",antGlow:"#00ccff",spiderGlow:"#0080ff",neon:true  },
  golden: { name:"Golden Vault", bg:"#1a1000",floor:"#2d1f00",wall:"#8b6914",accent:"#ffd700",crumb:"#ffec8b",sugar:"#ffe066",crystal:"#ffa500",antGlow:"#ffd700",spiderGlow:"#ff8c00",neon:false },
  shadow: { name:"Shadow Realm", bg:"#050005",floor:"#0d000d",wall:"#1a001a",accent:"#9900ff",crumb:"#cc66ff",sugar:"#ff00ff",crystal:"#ff66ff",antGlow:"#cc00ff",spiderGlow:"#ff00ff",neon:true  },
  amber:  { name:"Amber Ruins",  bg:"#1a0d00",floor:"#261300",wall:"#7a3d00",accent:"#ff8c00",crumb:"#ffaa44",sugar:"#ffcc77",crystal:"#ff6600",antGlow:"#ff8c00",spiderGlow:"#cc4400",neon:false },
  toxic:  { name:"Toxic Depths", bg:"#001a00",floor:"#002600",wall:"#004d00",accent:"#00ff41",crumb:"#66ff66",sugar:"#00ff99",crystal:"#ff00ff",antGlow:"#00ff41",spiderGlow:"#ff00ff",neon:true  },
  void:   { name:"Void Core",    bg:"#000000",floor:"#030303",wall:"#0a0a0a",accent:"#ffffff",crumb:"#cccccc",sugar:"#888888",crystal:"#ff0080",antGlow:"#ffffff",spiderGlow:"#ff0080",neon:true  },
};

function cellKey(cell: Cell) {
  return `${cell.row}:${cell.col}`;
}

function isOuterBorder(row: number, col: number) {
  return row === 0 || row === GRID_ROWS - 1 || col === 0 || col === GRID_COLS - 1;
}

const TUNNEL_LAYOUTS = [
  // 1) Split Path
  [
    "2:5","2:6","2:7","2:8","2:14","2:15","2:16",
    "3:8","3:14",
    "4:4","4:5","4:10","4:11","4:12","4:17",
    "5:10","5:17",
    "6:6","6:7","6:8","6:14","6:15","6:16",
    "7:6","7:16",
    "8:4","8:5","8:10","8:11","8:12","8:17",
    "9:10","9:17",
    "10:7","10:8","10:9","10:14","10:15",
  ],

  // 2) Narrow Spine
  [
    "2:4","2:5","2:6","2:7","2:15","2:16","2:17",
    "3:7","3:15",
    "4:7","4:9","4:10","4:11","4:15",
    "5:4","5:5","5:6","5:11","5:16","5:17",
    "6:11",
    "7:4","7:5","7:6","7:11","7:16","7:17",
    "8:7","8:9","8:10","8:11","8:15",
    "9:7","9:15",
    "10:5","10:6","10:7","10:15","10:16",
  ],

  // 3) Broken Cross
  [
    "2:9","2:10","2:11","2:12",
    "3:5","3:6","3:15","3:16",
    "4:5","4:10","4:11","4:16",
    "5:5","5:10","5:11","5:16",
    "6:3","6:4","6:5","6:6","6:15","6:16","6:17","6:18",
    "7:9","7:10","7:11","7:12",
    "8:3","8:4","8:5","8:6","8:15","8:16","8:17","8:18",
    "9:5","9:10","9:11","9:16",
    "10:5","10:6","10:15","10:16",
  ],

  // 4) Double Fork
  [
    "2:6","2:7","2:8","2:13","2:14","2:15",
    "3:8","3:13",
    "4:4","4:5","4:6","4:10","4:11","4:15","4:16","4:17",
    "5:11",
    "6:7","6:8","6:9","6:13","6:14","6:15",
    "7:4","7:5","7:10","7:11","7:16","7:17",
    "8:10","8:11",
    "9:6","9:7","9:8","9:13","9:14","9:15",
    "10:4","10:5","10:16","10:17",
  ],

  // 5) Ring Cut
  [
    "2:5","2:6","2:7","2:8","2:9","2:13","2:14","2:15","2:16",
    "3:5","3:16",
    "4:5","4:8","4:9","4:12","4:13","4:16",
    "5:5","5:12","5:16",
    "6:5","6:6","6:7","6:12","6:16",
    "7:12","7:16",
    "8:5","8:6","8:7","8:12","8:16",
    "9:5","9:8","9:9","9:12","9:13","9:16",
    "10:5","10:16",
  ],

  // 6) Maze Teeth
  [
    "2:4","2:5","2:10","2:11","2:16","2:17",
    "3:5","3:10","3:16",
    "4:5","4:6","4:7","4:11","4:12","4:13","4:17",
    "5:7","5:12","5:17",
    "6:4","6:5","6:9","6:10","6:14","6:15",
    "7:4","7:10","7:15",
    "8:4","8:5","8:6","8:10","8:11","8:12","8:15","8:16","8:17",
    "9:6","9:11","9:16",
    "10:6","10:7","10:12","10:13","10:16","10:17",
  ],

  // 7) Cracked Chamber
  [
    "2:7","2:8","2:9","2:14","2:15",
    "3:4","3:5","3:12","3:13","3:17","3:18",
    "4:5","4:9","4:10","4:13","4:17",
    "5:9","5:13",
    "6:3","6:4","6:5","6:8","6:9","6:13","6:14","6:17","6:18",
    "7:8","7:14",
    "8:5","8:9","8:10","8:13","8:17",
    "9:4","9:5","9:12","9:13","9:17","9:18",
    "10:7","10:8","10:14","10:15",
  ],

  // 8) Death Lanes
  [
    "2:4","2:5","2:6","2:12","2:13","2:17","2:18",
    "3:6","3:12","3:17",
    "4:6","4:7","4:8","4:12","4:13","4:14","4:17",
    "5:8","5:14",
    "6:4","6:5","6:8","6:9","6:14","6:15","6:17","6:18",
    "7:9","7:15",
    "8:4","8:5","8:8","8:9","8:14","8:15","8:17","8:18",
    "9:5","9:10","9:11","9:16",
    "10:5","10:6","10:10","10:11","10:16","10:17",
  ],

  // 9) Twin Corridors
  [
    "2:6","2:7","2:8","2:9","2:13","2:14","2:15","2:16",
    "3:9","3:13",
    "4:4","4:5","4:9","4:13","4:17","4:18",
    "5:5","5:9","5:13","5:17",
    "6:5","6:6","6:7","6:10","6:12","6:15","6:16","6:17",
    "7:10","7:12",
    "8:5","8:6","8:7","8:10","8:12","8:15","8:16","8:17",
    "9:5","9:9","9:13","9:17",
    "10:4","10:5","10:9","10:13","10:17","10:18",
  ],

  // 10) Spiral Trap
  [
    "2:4","2:5","2:6","2:7","2:8","2:9","2:10","2:11","2:12","2:13","2:14","2:15","2:16",
    "3:4","3:16",
    "4:4","4:6","4:7","4:8","4:9","4:10","4:11","4:12","4:13","4:14","4:16",
    "5:4","5:6","5:14","5:16",
    "6:4","6:6","6:8","6:9","6:10","6:11","6:12","6:14","6:16",
    "7:4","7:8","7:12","7:16",
    "8:4","8:6","8:8","8:9","8:10","8:11","8:12","8:14","8:16",
    "9:4","9:6","9:14","9:16",
    "10:4","10:5","10:6","10:7","10:8","10:9","10:10","10:11","10:12","10:13","10:14","10:15","10:16",
  ],,
  ["2:4","2:5","2:6","2:16","2:17","2:18","3:6","3:16","4:6","4:7","4:8","4:14","4:15","4:16","5:8","5:14","6:8","6:9","6:10","6:12","6:13","6:14","7:10","7:12","8:8","8:9","8:10","8:12","8:13","8:14","9:8","9:14","10:6","10:7","10:8","10:14","10:15","10:16"],
  ["2:4","2:5","2:9","2:10","2:14","2:15","2:19","3:4","3:9","3:14","3:19","4:4","4:5","4:6","4:9","4:10","4:14","4:15","4:19","5:6","5:19","6:4","6:5","6:6","6:9","6:12","6:13","6:14","6:17","6:18","6:19","7:4","7:9","7:12","7:17","8:4","8:5","8:9","8:10","8:12","8:13","8:17","8:18","9:5","9:13","9:18","10:5","10:6","10:9","10:10","10:13","10:14","10:18","10:19"],
  ["2:4","2:5","2:6","2:7","2:8","2:9","3:4","3:9","3:14","3:15","3:16","3:17","3:18","4:4","4:9","4:18","5:4","5:5","5:9","5:10","5:14","5:18","6:5","6:10","6:14","6:15","6:18","7:5","7:6","7:10","7:15","7:18","7:19","8:6","8:10","8:11","8:15","8:19","9:6","9:7","9:11","9:15","9:16","9:19","10:7","10:8","10:11","10:12","10:16","10:17","10:19"],
  ["2:4","2:5","2:6","2:7","2:8","2:9","2:10","2:11","2:12","2:13","2:14","2:15","2:16","2:17","3:4","3:17","4:4","4:6","4:7","4:8","4:9","4:10","4:11","4:12","4:13","4:14","4:15","4:17","5:4","5:6","5:15","5:17","6:4","6:6","6:8","6:9","6:10","6:11","6:12","6:13","6:15","6:17","7:4","7:6","7:8","7:13","7:15","7:17","8:4","8:6","8:8","8:9","8:10","8:11","8:12","8:13","8:15","8:17","9:4","9:6","9:15","9:17","10:4","10:5","10:6","10:7","10:8","10:9","10:12","10:13","10:14","10:15","10:17"],
  ["2:4","2:5","2:11","2:12","3:5","3:11","4:5","4:6","4:11","4:12","4:17","4:18","5:6","5:12","5:17","6:6","6:7","6:12","6:13","6:17","6:18","7:7","7:13","7:18","8:7","8:8","8:13","8:14","8:18","8:19","9:8","9:14","9:19","10:4","10:8","10:9","10:14","10:15","10:19"],
  ["2:4","2:5","2:6","2:7","2:8","2:14","2:15","2:16","2:17","2:18","3:4","3:8","3:14","3:18","4:4","4:8","4:9","4:10","4:12","4:13","4:14","4:18","5:4","5:10","5:12","5:18","6:4","6:5","6:6","6:10","6:12","6:15","6:16","6:18","7:6","7:10","7:12","7:15","7:18","8:6","8:7","8:8","8:10","8:12","8:15","8:18","8:19","9:8","9:10","9:15","9:19","10:8","10:9","10:10","10:11","10:12","10:15","10:16","10:19"],
  ["2:8","2:9","2:10","2:11","2:12","3:5","3:6","3:16","3:17","4:5","4:6","4:7","4:15","4:16","4:17","5:6","5:7","5:8","5:14","5:15","5:16","6:7","6:8","6:14","6:15","7:7","7:8","7:14","7:15","8:6","8:7","8:8","8:14","8:15","8:16","9:5","9:6","9:7","9:15","9:16","9:17","10:8","10:9","10:10","10:11","10:12"],
  ["2:6","2:7","2:8","2:9","2:10","2:11","2:12","2:13","2:14","2:15","3:6","3:15","4:6","4:8","4:9","4:10","4:11","4:12","4:13","4:15","5:6","5:8","5:13","5:15","6:6","6:8","6:10","6:11","6:13","6:15","7:6","7:8","7:13","7:15","8:6","8:8","8:9","8:10","8:11","8:12","8:13","8:15","9:6","9:15","10:6","10:7","10:8","10:9","10:12","10:13","10:14","10:15"],
  ["2:4","2:6","2:8","2:10","2:12","2:14","2:16","2:18","3:5","3:9","3:13","3:17","4:4","4:6","4:8","4:10","4:12","4:14","4:16","4:18","5:5","5:7","5:11","5:15","5:19","6:4","6:6","6:8","6:10","6:12","6:14","6:16","6:18","7:5","7:9","7:13","7:17","8:4","8:6","8:8","8:10","8:12","8:14","8:16","8:18","9:5","9:7","9:11","9:15","9:19","10:4","10:6","10:8","10:10","10:12","10:14","10:16","10:18"],
  ["2:4","2:5","2:17","2:18","3:5","3:10","3:11","3:12","3:17","4:5","4:6","4:10","4:12","4:17","4:18","5:6","5:10","5:12","5:18","6:6","6:7","6:10","6:11","6:12","6:15","6:16","7:7","7:15","8:7","8:8","8:10","8:11","8:12","8:15","8:16","9:8","9:10","9:12","9:16","10:8","10:9","10:10","10:12","10:13","10:16","10:17"],
  ["2:5","2:6","2:7","2:8","2:9","2:10","2:11","2:12","2:13","2:14","2:15","2:16","3:5","3:16","4:5","4:7","4:8","4:9","4:13","4:14","4:15","4:16","5:5","5:7","5:13","6:5","6:7","6:8","6:9","6:11","6:12","6:13","6:16","7:5","7:9","7:11","7:16","8:5","8:7","8:9","8:10","8:11","8:13","8:14","8:16","9:5","9:7","9:13","9:16","10:5","10:6","10:7","10:13","10:14","10:15","10:16"],
  ["2:11","3:9","3:10","3:12","3:13","4:7","4:8","4:14","4:15","5:5","5:6","5:16","5:17","6:4","6:5","6:17","6:18","7:5","7:6","7:16","7:17","8:7","8:8","8:14","8:15","9:9","9:10","9:12","9:13","10:11"],
  ["2:4","2:5","2:6","2:7","2:8","2:9","2:10","2:11","2:12","2:13","2:14","2:15","2:16","2:17","2:18","3:4","3:18","4:4","4:6","4:7","4:8","4:9","4:10","4:11","4:12","4:13","4:14","4:15","4:16","4:18","5:4","5:6","5:16","5:18","6:4","6:6","6:8","6:9","6:10","6:11","6:12","6:14","6:16","6:18","7:4","7:8","7:14","7:18","8:4","8:6","8:8","8:10","8:11","8:12","8:14","8:16","8:18","9:4","9:6","9:12","9:16","9:18","10:4","10:6","10:7","10:8","10:9","10:10","10:12","10:16","10:18"],
  ["2:4","2:5","2:8","2:9","2:12","2:13","2:16","2:17","3:4","3:8","3:12","3:16","4:4","4:5","4:8","4:9","4:12","4:13","4:16","4:17","6:4","6:5","6:8","6:9","6:12","6:13","6:16","6:17","7:4","7:8","7:12","7:16","8:4","8:5","8:8","8:9","8:12","8:13","8:16","8:17","10:4","10:5","10:8","10:9","10:12","10:13","10:16","10:17"],
  ["2:5","2:6","2:7","2:13","2:14","3:5","3:13","4:5","4:6","4:9","4:10","4:11","4:13","4:14","4:17","4:18","5:6","5:9","5:11","5:14","5:17","6:6","6:7","6:9","6:11","6:14","6:15","6:17","6:18","7:7","7:9","7:11","7:15","7:18","8:7","8:8","8:9","8:11","8:12","8:15","8:18","8:19","9:8","9:12","9:15","9:19","10:8","10:9","10:12","10:13","10:15","10:16","10:19"],
  ["2:4","2:5","2:6","2:7","3:7","3:12","3:13","3:14","3:15","4:7","4:15","5:5","5:6","5:7","5:15","5:16","5:17","5:18","6:5","6:18","7:5","7:6","7:7","7:8","7:9","7:10","7:18","8:5","8:10","8:18","9:5","9:10","9:11","9:14","9:15","9:16","9:17","9:18","10:5","10:6","10:11","10:14"],
  ["2:5","2:6","2:9","2:10","2:13","2:14","2:17","2:18","3:6","3:9","3:13","3:17","4:6","4:7","4:9","4:10","4:13","4:14","4:17","4:18","5:7","5:10","5:14","5:18","6:5","6:6","6:7","6:10","6:11","6:14","6:15","6:18","6:19","7:5","7:11","7:15","7:19","8:5","8:6","8:9","8:10","8:11","8:15","8:16","8:19","9:6","9:9","9:16","9:19","10:6","10:7","10:9","10:10","10:16","10:17","10:19"],
  ["2:4","2:5","2:6","2:7","2:8","2:9","2:10","3:4","3:10","4:4","4:6","4:7","4:8","4:9","4:10","4:11","4:12","4:13","5:4","5:6","5:13","6:4","6:6","6:8","6:9","6:10","6:11","6:12","6:13","6:14","6:15","7:4","7:8","7:15","8:4","8:8","8:10","8:11","8:12","8:13","8:14","8:15","8:16","8:17","9:4","9:10","9:17","10:4","10:10","10:12","10:13","10:14","10:15","10:16","10:17","10:18"],
  ["2:7","2:8","2:9","2:10","2:11","2:12","2:13","2:14","2:15","3:7","3:15","4:7","4:9","4:10","4:11","4:12","4:13","4:15","5:7","5:9","5:13","5:15","6:7","6:9","6:11","6:13","6:15","7:7","7:9","7:11","7:15","8:7","8:9","8:10","8:11","8:12","8:13","8:14","8:15","9:7","9:15","10:7","10:8","10:9","10:10","10:11","10:12","10:13","10:14","10:15"],
  ["2:3","2:4","2:5","2:6","2:7","2:8","2:9","2:10","2:11","2:12","2:13","2:14","2:15","2:16","2:17","2:18","3:3","3:18","4:3","4:5","4:6","4:7","4:11","4:12","4:13","4:15","4:16","4:18","5:3","5:5","5:9","5:10","5:13","5:16","5:18","6:3","6:5","6:7","6:8","6:9","6:13","6:14","6:16","6:18","7:3","7:5","7:7","7:11","7:14","7:16","7:18","8:3","8:5","8:7","8:8","8:9","8:10","8:11","8:14","8:16","8:18","9:3","9:5","9:9","9:14","9:16","9:18","10:3","10:5","10:6","10:7","10:8","10:9","10:14","10:16","10:17","10:18"]
];

const LAYOUT_NAMES = [
  "Split Path","Narrow Spine","Broken Cross","Double Fork","Ring Cut",
  "Maze Teeth","Cracked Chamber","Death Lanes","Twin Corridors","Spiral Trap",
  "Pincer","Catacomb","River","Fortress","Zipper",
  "Labyrinth","Cross Fire","The Trap","Checkers","Spine",
  "Corridor Wars","Diamond","Snake Pit","Pillars","Archipelago",
  "Cascade","Honeycomb","Staircase","Vortex","Final Boss",
];

function baseWall(row: number, col: number, layoutIndex: number) {
  if (isOuterBorder(row, col)) return true;
  const layout = (TUNNEL_LAYOUTS[layoutIndex] || TUNNEL_LAYOUTS[0]) as string[];
  return layout.includes(`${row}:${col}`);
}

function isBreakableBaseWall(row: number, col: number, layoutIndex: number) {
  if (isOuterBorder(row, col)) return false;
  return baseWall(row, col, layoutIndex);
}

function isWall(row: number, col: number, brokenWallSet: Set<string>, layoutIndex: number) {
  if (!baseWall(row, col, layoutIndex)) return false;
  return !brokenWallSet.has(cellKey({ row, col }));
}

function getOpenCells(brokenWallSet: Set<string>, layoutIndex: number) {
  const open: Cell[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      if (!isWall(row, col, brokenWallSet, layoutIndex)) {
        open.push({ row, col });
      }
    }
  }
  return open;
}

function pickRandomCells(source: Cell[], count: number, excluded: Set<string>) {
  const available = source.filter((cell) => !excluded.has(cellKey(cell)));
  const pool = [...available];

  for (let i = pool.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, count);
}

function manhattanDistance(a: Cell, b: Cell) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function burstColor(kind: "crumb" | "sugar" | "crystal") {
  if (kind === "crumb") return "#22c55e";
  if (kind === "sugar") return "#facc15";
  return "#3b82f6";
}

function formatMs(ms: number) {
  const safe = Math.max(0, Number(ms || 0));
  const totalSeconds = safe / 1000;
  return `${totalSeconds.toFixed(2)}s`;
}

// ── Difficulty levels ──────────────────────────────────────────────────────
const DIFFICULTY: Record<string, {label:string;emoji:string;desc:string}> = {
  colony:  {label:"The Colony",  emoji:"🐜", desc:"Classic colony. Learn the ropes."},
  neon:    {label:"Neon Grid",  emoji:"⚡", desc:"Electric. Spider moves faster."},
  mythic:  {label:"Mythic Dark",  emoji:"🔮", desc:"Dark magic. Tighter paths."},
  lava:    {label:"Lava Caves",  emoji:"🌋", desc:"Volcanic. Heat slows your breaks."},
  ice:     {label:"Ice Caverns",  emoji:"🧊", desc:"Frozen. Spider is relentless."},
  golden:  {label:"Golden Vault",  emoji:"🏆", desc:"Guarded vault. Charges dwindling."},
  shadow:  {label:"Shadow Realm",  emoji:"👁️", desc:"You barely see the walls."},
  amber:   {label:"Amber Ruins",  emoji:"🏺", desc:"Ancient stone. Walls resist breaking."},
  toxic:   {label:"Toxic Depths",  emoji:"☢️", desc:"Poison mist. Near impossible odds."},
  void:    {label:"Void Core", emoji:"💀", desc:"Pure darkness. Maximum intensity."},
};

export default function TunnelShell() {
  const initialProfile = loadProfile();
  const initialName = (initialProfile?.name || "guest").trim() || "guest";
  const initialEffectiveId = getEffectivePlayerId(initialProfile);

    const [playerName, setPlayerName] = useState(initialName);
  const [effectivePlayerId, setEffectivePlayerId] = useState(initialEffectiveId);

  // ✅ Keep effectivePlayerId in sync when identity changes (Discord connect/disconnect/wallet)
  React.useEffect(() => {
    const update = () => setEffectivePlayerId(getEffectivePlayerId(loadProfile()));
    update();
    window.addEventListener("ra:identity-changed", update);
    return () => window.removeEventListener("ra:identity-changed", update);
  }, []);

  const [dailyClaimed,   setDailyClaimed]   = useState(false);
  const [nextClaimTs,    setNextClaimTs]    = useState<number|null>(null);
  const [countdownStr,   setCountdownStr]   = useState("");
  const [dripAmount,     setDripAmount]     = useState(0);
  const [profileVersion, setProfileVersion] = useState(0);
  const [dripPanelOpen,  setDripPanelOpen]  = useState(false);
  const [dripBusy,       setDripBusy]       = useState(false);
  const [dripBalance,    setDripBalance]    = useState<number|null>(null);
  const [dripStatus,     setDripStatus]     = useState("");
  const [showBuyPoints, setShowBuyPoints] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const { muted, toggleMute, startAmbient, stopAmbient, sfx } = useAudio();
  React.useEffect(() => { startAmbient(); return () => { stopAmbient(); }; }, []); // start ambient on mount, stop on unmount
  const [tunnelCfg, setTunnelCfg] = useState(DEFAULT_TUNNEL_CONFIG);

    const [boardTheme, setBoardTheme] = useState<BoardTheme>("colony");
  const [layoutIndex, setLayoutIndex] = useState(0);
  const [countdown, setCountdown] = useState<number|null>(null);
  const [layoutMode, setLayoutMode] = useState<"random"|"pick">("random");
  const [selectedLayout, setSelectedLayout] = useState<number|null>(null);
  const [layoutsExplored, setLayoutsExplored] = useState(0);
  const [layoutChampions, setLayoutChampions] = useState<{layoutIndex:number;layoutName:string;topScores:{rank:number;playerId:string;playerName:string;score:number}[];fastestClears:{rank:number;playerId:string;playerName:string;clearTimeMs:number}[]}[]>([]);
const [isPlaying, setIsPlaying] = useState(false);
const [timeLeft, setTimeLeft] = useState(DEFAULT_TUNNEL_CONFIG.tunnelRunSeconds);
const [score, setScore] = useState(0);
const [runMessage, setRunMessage] = useState("");
const [didWinRun, setDidWinRun] = useState(false);
  const [lastRunResult, setLastRunResult] = React.useState<{layoutName:string;layoutNum:number;score:number;clearTimeMs:number|null;wasFullClear:boolean}|null>(null);
const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
const [runCrystalTarget, setRunCrystalTarget] = useState(0);
  const [playerPos, setPlayerPos] = useState<Cell>(START_CELL);
   const [crumbs, setCrumbs] = useState<Cell[]>([]);
  const [sugars, setSugars] = useState<Cell[]>([]);
  const [crystals, setCrystals] = useState<Cell[]>([]);
    const [spiderPos, setSpiderPos] = useState<Cell>({ row: 1, col: 10 });
   const [wallBreaksLeft, setWallBreaksLeft] = useState(
    DEFAULT_TUNNEL_CONFIG.tunnelWallBreaks
  );
  const [brokenWalls, setBrokenWalls] = useState<string[]>([]);
  const [facing, setFacing] = useState<Facing>("right");
    const [pickupBursts, setPickupBursts] = useState<PickupBurst[]>([]);
  const [wallBursts, setWallBursts] = useState<WallBurst[]>([]);
  const [hitFlash, setHitFlash] = useState(false);
  const [hitShake, setHitShake] = useState(false);

    const [topScoreRows, setTopScoreRows] = useState<TunnelScoreRow[]>([]);
  const [fastestClearRows, setFastestClearRows] = useState<TunnelFastestRow[]>([]);
  const [personalStats, setPersonalStats] = useState<TunnelPersonalStats | null>(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [isLandscape, setIsLandscape] = useState(true);

    const lastHitRef = useRef(0);
  const dpadIntervalRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const dpadActionRef = useRef<(a:"up"|"down"|"left"|"right")=>void>(()=>{});
  const gameBoardTopRef = useRef<HTMLDivElement | null>(null);
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const playerTileRef = useRef<HTMLDivElement | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

     const {
    balance,
    capBank,
    remainingDaily,
    totalEarnRoom,
    dailyCap,
    refresh,
    earn,
    spend,
  } = usePoints(effectivePlayerId);
    const theme = themeMap[boardTheme];
  const brokenWallSet = useMemo(() => new Set(brokenWalls), [brokenWalls]);

   function triggerPickupBurst(row: number, col: number, kind: "crumb" | "sugar" | "crystal") {
    const id = Date.now() + Math.floor(Math.random() * 100000);
    setPickupBursts((prev) => [...prev, { id, row, col, kind }]);

    window.setTimeout(() => {
      setPickupBursts((prev) => prev.filter((b) => b.id !== id));
    }, 260);
  }

      function triggerWallBurst(row: number, col: number) {
    const id = Date.now() + Math.floor(Math.random() * 100000);
    setWallBursts((prev) => [...prev, { id, row, col }]);

    window.setTimeout(() => {
      setWallBursts((prev) => prev.filter((b) => b.id !== id));
    }, 260);
  }

  async function loadTunnelLeaderboard() {
    try {
      setLeaderboardLoading(true);

      const r = await fetch(
        `/api/tunnel/leaderboard?playerId=${encodeURIComponent(effectivePlayerId)}&top=5`,
        { cache: "no-store" }
      );

      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok) return;

      // topScore global panel removed
      // fastestClear global panel removed
      setPersonalStats(j.personalStats || null);
      setLayoutsExplored(Number(j.layoutsExplored || 0));
      setLayoutChampions(Array.isArray(j.layoutChampions) ? j.layoutChampions : []);
    } catch {
      // ignore for now
    } finally {
      setLeaderboardLoading(false);
    }
  }

  function scrollBackToBoardHeader() {
    if (typeof window === "undefined") return;

    requestAnimationFrame(() => {
      gameBoardTopRef.current?.scrollIntoView({
        block: "start",
        behavior: "auto",
      });
    });
  }
  
   async function recordTunnelRun(params: {
    score: number;
    fullClear: boolean;
    crystalsCollected: number;
  }) {
    try {
      const clearTimeMs =
        params.fullClear && runStartedAt
          ? Math.max(0, Date.now() - runStartedAt)
          : 0;

      await fetch("/api/tunnel/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: effectivePlayerId,
          playerName,
          score: params.score,
          fullClear: params.fullClear,
          clearTimeMs,
          crystalsCollected: params.crystalsCollected,
          layoutIndex,
          layoutName: LAYOUT_NAMES[layoutIndex] || "Layout " + (layoutIndex + 1),
        }),
      });
    } catch {
      // do not block gameplay if stats save fails
    }
  }

       function handleSwipeStart(e: React.TouchEvent<HTMLDivElement>) {
    if (!isMobileView || !isPlaying) return;
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
  }

  function handleSwipeMove(e: React.TouchEvent<HTMLDivElement>) {
    if (!isMobileView || !isPlaying) return;
    e.preventDefault();
  }

  function handleSwipeEnd(e: React.TouchEvent<HTMLDivElement>) {
    if (!isMobileView || !isPlaying) return;
    e.preventDefault();

    const startX = touchStartXRef.current;
    const startY = touchStartYRef.current;
    const touch = e.changedTouches[0];

    touchStartXRef.current = null;
    touchStartYRef.current = null;

    if (startX == null || startY == null || !touch) return;

    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const minSwipe = 22;

    if (absX < minSwipe && absY < minSwipe) return;

    if (absX > absY) {
      if (dx > 0) handleTunnelAction("right");
      else handleTunnelAction("left");
    } else {
      if (dy > 0) handleTunnelAction("down");
      else handleTunnelAction("up");
    }
  }

  function pressMobileBreak(
    e: React.MouseEvent<HTMLButtonElement> | React.TouchEvent<HTMLButtonElement>
  ) {
    e.preventDefault();
    e.stopPropagation();
    handleTunnelAction("break");
  }

  function resetDesktopBoardView() {
    if (isMobileView) return;

    const wrap = boardScrollRef.current;
    const playerEl = playerTileRef.current;
    if (!wrap || !playerEl) return;

    requestAnimationFrame(() => {
      const wrapRect = wrap.getBoundingClientRect();
      const playerRect = playerEl.getBoundingClientRect();

      const relativeLeft = playerRect.left - wrapRect.left + wrap.scrollLeft;
      const relativeTop = playerRect.top - wrapRect.top + wrap.scrollTop;

      const targetLeft =
        relativeLeft - wrap.clientWidth / 2 + playerRect.width / 2;

      const targetTop =
        relativeTop - wrap.clientHeight / 2 + playerRect.height / 2;

      wrap.scrollLeft = Math.max(
        0,
        Math.min(targetLeft, wrap.scrollWidth - wrap.clientWidth)
      );

      wrap.scrollTop = Math.max(
        0,
        Math.min(targetTop, wrap.scrollHeight - wrap.clientHeight)
      );
    });
  }
  

  // D-pad hold-to-repeat helpers
  function stopDpadRepeat() {
    if (dpadIntervalRef.current !== null) { clearInterval(dpadIntervalRef.current); dpadIntervalRef.current = null; }
  }
  function startDpadRepeat(action: "up"|"down"|"left"|"right") {
    stopDpadRepeat();
    dpadActionRef.current(action);
    dpadIntervalRef.current = setInterval(() => dpadActionRef.current(action), 80);
  }

  function handleTunnelAction(action: "up" | "down" | "left" | "right" | "break") {
    if (!isPlaying) return;

    if (action === "break") {
      if (wallBreaksLeft <= 0) {
        setRunMessage("No wall breakers left.");
        return;
      }

      const target = { row: playerPos.row, col: playerPos.col };

      if (facing === "up") target.row -= 1;
      if (facing === "down") target.row += 1;
      if (facing === "left") target.col -= 1;
      if (facing === "right") target.col += 1;

      if (
        target.row < 0 ||
        target.row >= GRID_ROWS ||
        target.col < 0 ||
        target.col >= GRID_COLS
      ) {
        return;
      }

      if (!isBreakableBaseWall(target.row, target.col, layoutIndex)) {
        setRunMessage("No breakable wall in front of you.");
        return;
      }

      const key = cellKey(target);
      if (brokenWallSet.has(key)) {
        setRunMessage("That wall is already broken.");
        return;
      }

      setBrokenWalls((prev) => [...prev, key]);
      setWallBreaksLeft((n) => Math.max(0, n - 1));
      sfx.wall();
      triggerWallBurst(target.row, target.col);
      setRunMessage("Wall broken ✅");
      return;
    }

    setPlayerPos((prev) => {
      let nextRow = prev.row;
      let nextCol = prev.col;
      let nextFacing: Facing = facing;

      if (action === "up") {
        nextRow -= 1;
        nextFacing = "up";
      }
      if (action === "down") {
        nextRow += 1;
        nextFacing = "down";
      }
      if (action === "left") {
        nextCol -= 1;
        nextFacing = "left";
      }
      if (action === "right") {
        nextCol += 1;
        nextFacing = "right";
      }

      setFacing(nextFacing);

      nextRow = Math.max(0, Math.min(GRID_ROWS - 1, nextRow));
      nextCol = Math.max(0, Math.min(GRID_COLS - 1, nextCol));

      if (isWall(nextRow, nextCol, brokenWallSet, layoutIndex)) return prev;
      if (nextRow === prev.row && nextCol === prev.col) return prev;

      setCrumbs((current) => {
        const found = current.some((c) => c.row === nextRow && c.col === nextCol);
        if (found) {
          setScore((s) => s + 1);
          triggerPickupBurst(nextRow, nextCol, "crumb");
          sfx.crumb();
        }
        return current.filter((c) => !(c.row === nextRow && c.col === nextCol));
      });

      setSugars((current) => {
        const found = current.some((c) => c.row === nextRow && c.col === nextCol);
        if (found) {
          setScore((s) => s + 5);
          triggerPickupBurst(nextRow, nextCol, "sugar");
          sfx.sugar();
        }
        return current.filter((c) => !(c.row === nextRow && c.col === nextCol));
      });

      setCrystals((current) => {
        const found = current.some((c) => c.row === nextRow && c.col === nextCol);
        if (found) {
          setScore((s) => s + 20);
          triggerPickupBurst(nextRow, nextCol, "crystal");
          sfx.crystal();
        }
        return current.filter((c) => !(c.row === nextRow && c.col === nextCol));
      });

      return { row: nextRow, col: nextCol };
    });
  }

   useEffect(() => {
    let cancelled = false;

    const loadTunnelConfig = async () => {
      try {
        const r = await fetch("/api/config", { cache: "no-store" });
        const j = await r.json().catch(() => null);
        const cfg = j?.pointsConfig || {};

        if (cancelled) return;

        const nextCfg = {
          currency: String(cfg?.currency || DEFAULT_TUNNEL_CONFIG.currency),
          dailyClaim: Number(cfg?.dailyClaim || DEFAULT_TUNNEL_CONFIG.dailyClaim),
          tunnelCost: Number(cfg?.tunnelCost || DEFAULT_TUNNEL_CONFIG.tunnelCost),
          tunnelRunSeconds: Number(cfg?.tunnelRunSeconds || DEFAULT_TUNNEL_CONFIG.tunnelRunSeconds),
          tunnelCrystalCount: Number(cfg?.tunnelCrystalCount || DEFAULT_TUNNEL_CONFIG.tunnelCrystalCount),
          tunnelSugarCount: Number(cfg?.tunnelSugarCount || DEFAULT_TUNNEL_CONFIG.tunnelSugarCount),
          tunnelCrumbCount: Number(cfg?.tunnelCrumbCount || DEFAULT_TUNNEL_CONFIG.tunnelCrumbCount),
          tunnelWallBreaks: Number(cfg?.tunnelWallBreaks || DEFAULT_TUNNEL_CONFIG.tunnelWallBreaks),
          tunnelSpiderSpeedMs: Number(cfg?.tunnelSpiderSpeedMs || DEFAULT_TUNNEL_CONFIG.tunnelSpiderSpeedMs),
        };

        setTunnelCfg(nextCfg);

        if (!isPlaying) {
          setWallBreaksLeft(nextCfg.tunnelWallBreaks);
          setTimeLeft(nextCfg.tunnelRunSeconds);
        }
      } catch {
        // keep defaults
      }
    };

    void loadTunnelConfig();

    return () => {
      cancelled = true;
    };
  }, [isPlaying]);

    useEffect(() => {
    void loadTunnelLeaderboard();
  }, [effectivePlayerId]);

  useEffect(() => {
    const updateMobileView = () => {
      if (typeof window === "undefined") return;
      setIsMobileView(window.innerWidth <= 900);
      setIsLandscape(window.innerWidth >= window.innerHeight);
    };

    updateMobileView();
    window.addEventListener("resize", updateMobileView);
    window.addEventListener("orientationchange", updateMobileView);

    return () => {
      window.removeEventListener("resize", updateMobileView);
      window.removeEventListener("orientationchange", updateMobileView);
    };
  }, []);

   useEffect(() => {
    if (typeof document === "undefined") return;

    const lockRunMode = isPlaying && isMobileView;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyTouchAction = document.body.style.touchAction;

    if (lockRunMode) {
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
    }

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.touchAction = prevBodyTouchAction;
    };
  }, [isPlaying, isMobileView]);

  useEffect(() => {
    if (!isPlaying || !isMobileView || !isLandscape) return;

    const id = requestAnimationFrame(() => {
      boardScrollRef.current?.scrollIntoView({
        block: "center",
        behavior: "auto",
      });
    });

    return () => cancelAnimationFrame(id);
  }, [isPlaying, isMobileView, isLandscape]);

  function setupNewRun() {
    const nextLayoutIndex = (layoutMode === "pick" && selectedLayout !== null) ? selectedLayout : Math.floor(Math.random() * TUNNEL_LAYOUTS.length);
    setLayoutIndex(nextLayoutIndex);

    const nextBrokenWalls: string[] = [];
    const nextBrokenWallSet = new Set(nextBrokenWalls);
    const openCells = getOpenCells(nextBrokenWallSet, nextLayoutIndex);

       const excluded = new Set<string>([
      cellKey(START_CELL),
      cellKey({ row: 1, col: 10 }),
    ]);

        const crumbCells = pickRandomCells(openCells, tunnelCfg.tunnelCrumbCount, excluded);
    crumbCells.forEach((c) => excluded.add(cellKey(c)));

    const sugarCells = pickRandomCells(openCells, tunnelCfg.tunnelSugarCount, excluded);
    sugarCells.forEach((c) => excluded.add(cellKey(c)));

    const crystalCells = pickRandomCells(openCells, tunnelCfg.tunnelCrystalCount, excluded);

    setBrokenWalls(nextBrokenWalls);
    setPlayerPos(START_CELL);
    setCrumbs(crumbCells);
    setSugars(sugarCells);
       setCrystals(crystalCells);
    setRunCrystalTarget(crystalCells.length);
    setSpiderPos({ row: 1, col: 10 });
    setScore(0);
    setTimeLeft(tunnelCfg.tunnelRunSeconds);
    setWallBreaksLeft(tunnelCfg.tunnelWallBreaks);
    setFacing("right");
    setRunMessage("");
    setDidWinRun(false);
    setRunStartedAt(Date.now());
    setLastRunResult(null);
    lastHitRef.current = 0;
  }

   async function startRun() {
    if (isPlaying) return;

        if (Number(totalEarnRoom || 0) < tunnelCfg.tunnelCost) {
      setRunMessage("No plays left today. Buy points to add bonus plays.");
      return;
    }

    if (balance < tunnelCfg.tunnelCost) {
      setRunMessage("Not enough points to start a Tunnel run.");
      return;
    }

    setRunMessage("Starting run...");

    try {
      const spendRes: any = await spend(tunnelCfg.tunnelCost, "tunnel");

      if (!spendRes?.ok) {
        setRunMessage(spendRes?.error || "Could not start Tunnel run.");
        return;
      }

             await refresh();
      setupNewRun();
      setCountdown(3);

      if (typeof window !== "undefined" && window.innerWidth <= 900) {
        requestAnimationFrame(() => {
          boardScrollRef.current?.scrollIntoView({
            block: "start",
            behavior: "auto",
          });
        });
      }

      if (typeof window !== "undefined" && window.innerWidth <= 900) {
        requestAnimationFrame(() => {
          window.scrollTo({ top: 0, behavior: "auto" });
        });
      }
    } catch (e: any) {
      setRunMessage(e?.message || "Could not start Tunnel run.");
    }
  }

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setTimeLeft((t) => Math.max(0, t - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying]);

      useEffect(() => {
    if (!isPlaying) return;
    if (timeLeft > 0) return;

    let cancelled = false;

        const finishRun = async () => {
      setIsPlaying(false);
      sfx.lose();
    setLastRunResult({ layoutName: LAYOUT_NAMES[layoutIndex]||("#"+(layoutIndex+1)), layoutNum: layoutIndex+1, score, clearTimeMs: null, wasFullClear: false });

            const crystalsCollected = Math.max(0, runCrystalTarget - crystals.length);
      await recordTunnelRun({
        score,
        fullClear: false,
        crystalsCollected,
      });
      await loadTunnelLeaderboard();

                 if (score <= 0) {
        setRunMessage("Run complete. No points earned this time.");
        scrollBackToBoardHeader();
        return;
      }

      setRunMessage(`Run complete. Claiming ${score} REBEL Points...`);

      try {
        const earnRes: any = await earn(score);
        if (cancelled) return;

        if (!earnRes?.ok) {
          setRunMessage(earnRes?.error || "Run complete, but reward claim failed.");
          return;
        }

                       setRunMessage(`Run complete. +${earnRes?.added ?? score} REBEL Points credited ✅`);
        await refresh();
        scrollBackToBoardHeader();
      } catch (e: any) {
        if (cancelled) return;
        setRunMessage(e?.message || "Run complete, but reward claim failed.");
      }
    };

    void finishRun();

    return () => {
      cancelled = true;
    };
  }, [timeLeft, isPlaying, score, earn, refresh, runCrystalTarget, crystals.length, runStartedAt, effectivePlayerId, playerName]);

   useEffect(() => {
    if (!isPlaying) return;
    if (crystals.length > 0) return;

    let cancelled = false;

       const finishCrystalRun = async () => {
      setIsPlaying(false);
      setDidWinRun(true);
      sfx.win();
    const _clearMs = runStartedAt ? Math.max(0, Date.now() - runStartedAt) : null;
    setLastRunResult({ layoutName: LAYOUT_NAMES[layoutIndex]||("#"+(layoutIndex+1)), layoutNum: layoutIndex+1, score, clearTimeMs: _clearMs, wasFullClear: true });

            await recordTunnelRun({
        score,
        fullClear: true,
        crystalsCollected: runCrystalTarget,
      });
      await loadTunnelLeaderboard();

               if (score <= 0) {
        setRunMessage("Crystal sweep complete! No points earned this time.");
        scrollBackToBoardHeader();
        return;
      }

      setRunMessage(`Crystal sweep complete! Claiming ${score} REBEL Points... 👑`);

      try {
        const earnRes: any = await earn(score);

        if (cancelled) return;

        if (!earnRes?.ok) {
          setRunMessage(earnRes?.error || "Crystal sweep complete, but reward claim failed.");
          return;
        }

                       setRunMessage(`Crystal sweep complete! +${earnRes?.added ?? score} REBEL Points credited 👑`);
        await refresh();
        scrollBackToBoardHeader();
      } catch (e: any) {
        if (cancelled) return;
        setRunMessage(e?.message || "Crystal sweep complete, but reward claim failed.");
      }
    };

    void finishCrystalRun();

    return () => {
      cancelled = true;
    };
   }, [crystals.length, isPlaying, score, earn, refresh, runCrystalTarget, runStartedAt, effectivePlayerId, playerName]);

    useEffect(() => {
    if (!isPlaying) return;

    const nextSpiderStep = (current: Cell) => {
      const directions = [
        { row: -1, col: 0 },
        { row: 1, col: 0 },
        { row: 0, col: -1 },
        { row: 0, col: 1 },
      ];

      const candidates = directions
        .map((move) => ({
          row: current.row + move.row,
          col: current.col + move.col,
        }))
        .filter(
          (next) =>
            next.row >= 0 &&
            next.row < GRID_ROWS &&
            next.col >= 0 &&
            next.col < GRID_COLS &&
                      !isWall(next.row, next.col, brokenWallSet, layoutIndex)
        );

      if (!candidates.length) return current;

      const ranked = [...candidates].sort((a, b) => {
        const da = manhattanDistance(a, playerPos);
        const db = manhattanDistance(b, playerPos);
        return da - db;
      });

      const roll = Math.random();

      // almost always choose the best chase move
      if (roll < 0.88) return ranked[0];
      if (roll < 0.97 && ranked[1]) return ranked[1];

      return ranked[(Math.random() * ranked.length) | 0];
    };

       const interval = setInterval(() => {
      setSpiderPos((current) => {
        const firstStep = nextSpiderStep(current);
        const distAfterFirst = manhattanDistance(firstStep, playerPos);

        if (distAfterFirst <= 6) {
          return nextSpiderStep(firstStep);
        }

        return firstStep;
      });
    }, tunnelCfg.tunnelSpiderSpeedMs);

    return () => clearInterval(interval);
   }, [isPlaying, playerPos, brokenWallSet, tunnelCfg.tunnelSpiderSpeedMs, layoutIndex]);
    useEffect(() => {
    if (!isPlaying) return;

    const now = Date.now();
    if (playerPos.row !== spiderPos.row || playerPos.col !== spiderPos.col) return;
    if (now - lastHitRef.current < 900) return;

    lastHitRef.current = now;
    setTimeLeft((t) => Math.max(0, t - 3));
    setRunMessage("Spider hit! -3 seconds");
    setHitFlash(true);
    setHitShake(true);
    sfx.spiderHit();

    window.setTimeout(() => {
      setHitFlash(false);
    }, 220);

    window.setTimeout(() => {
      setHitShake(false);
    }, 180);
  }, [playerPos, spiderPos, isPlaying]);

                  useLayoutEffect(() => {
    const playerEl = playerTileRef.current;
    if (!playerEl || !isPlaying) return;

    const raf = requestAnimationFrame(() => {
      playerEl.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "auto",
      });
    });

    return () => cancelAnimationFrame(raf);
  }, [playerPos, isPlaying]);
  
    useEffect(() => {
    if (!isPlaying) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const validMove = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      const isBreak = e.code === "Space";

      if (!validMove.includes(e.key) && !isBreak) return;

      e.preventDefault();

      if (isBreak) {
        handleTunnelAction("break");
        return;
      }

      if (e.key === "ArrowUp") handleTunnelAction("up");
      if (e.key === "ArrowDown") handleTunnelAction("down");
      if (e.key === "ArrowLeft") handleTunnelAction("left");
      if (e.key === "ArrowRight") handleTunnelAction("right");
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPlaying, facing, playerPos, wallBreaksLeft, brokenWallSet, layoutIndex]);
  function formatCountdown(ms: number): string {
    if (ms <= 0) return "00:00:00";
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return [h, m, sec].map(n => String(n).padStart(2, "0")).join(":");
  }

  async function claimDailyNow() {
    if (dailyClaimed || !effectivePlayerId) return;
    try {
      const r = await fetch("/api/points/claim", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ playerId: effectivePlayerId }) });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) { setDailyClaimed(true); if (j.msUntilNextClaim) setNextClaimTs(Date.now() + Number(j.msUntilNextClaim)); }
    } catch {}
  }

  React.useEffect(() => {
    if (!effectivePlayerId) return;
    (async () => {
      try {
        const r = await fetch(`/api/points/claim?playerId=${encodeURIComponent(effectivePlayerId)}`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (r.ok && j?.ok) { setDailyClaimed(!!j.claimed); if (j.msUntilNextClaim) setNextClaimTs(Date.now() + Number(j.msUntilNextClaim)); }
      } catch {}
    })();
  }, [effectivePlayerId]);

  React.useEffect(() => {
    if (!nextClaimTs) return;
    const tick = () => {
      const rem = nextClaimTs - Date.now();
      if (rem <= 0) { setCountdownStr(""); setDailyClaimed(false); setNextClaimTs(null); }
      else setCountdownStr(formatCountdown(rem));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nextClaimTs]);


  // ── Reload profile after Discord OAuth ────────────────────────────────────
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("discord") === "1") {
      const url = new URL(window.location.href);
      url.searchParams.delete("discord");
      window.history.replaceState({}, "", url.toString());
      // Force re-render so inline discord vars recompute
      setRunMessage("");
    }
  }, []);


  // ── Sync Discord session to localStorage (matches Shuffle.tsx) ──────────────
  const _didDiscordLinkRef = React.useRef(false);
  React.useEffect(() => {
    if (_didDiscordLinkRef.current) return;
    _didDiscordLinkRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const gate = loadProfile();
        if ((gate as any)?.discordSkipLink) return;
        const sr = await fetch("/api/auth/discord/session", { cache: "no-store" });
        const sj = await sr.json().catch(() => null);
        if (!sr.ok || !sj?.ok || !sj?.discordUserId) return;
        const prof = loadProfile();
        const toId = `discord:${sj.discordUserId}`;
        if (String((prof as any)?.primaryId || "") === toId) return;
        const lr = await fetch("/api/identity/link-discord", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromId: getEffectivePlayerId(prof) }),
        });
        const lj = await lr.json().catch(() => null);
        if (!lr.ok || !lj?.ok) return;
        saveProfile({
          ...(prof as any),
          discordUserId: sj.discordUserId,
          discordName: sj.discordName,
          primaryId: toId,
          name: sj.discordName || (prof as any)?.name,
          discordSkipLink: false,
        } as any);
        setProfileVersion(v => v + 1);
        setEffectivePlayerId(`discord:${sj.discordUserId}`);
        // Reload DRIP balance now that discord is connected
        try {
          const br = await fetch("/api/drip/balance", { cache: "no-store" });
          const bj = await br.json().catch(() => null);
          if (br.ok && bj?.ok) setDripBalance(Number(bj.balance || 0));
        } catch {}
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Load DRIP balance when discord is connected ──────────────────────────
  React.useEffect(() => {
    const p = loadProfile();
    if (!(p as any)?.discordUserId) return;
    (async () => {
      try {
        const r = await fetch("/api/drip/balance", { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (r.ok && j?.ok) setDripBalance(Number(j.balance || 0));
      } catch {}
    })();
  }, [effectivePlayerId]);

  // ── Discord identity (computed inline like Raid.tsx) ─────────────────────
  const _profile = loadProfile();
  const discordUserId: string | null = (_profile as any)?.discordUserId || null;
  const discordName: string = (_profile as any)?.discordName || "";
  const showDisconnect: boolean = !!discordUserId;
  const identityDisplay: string = discordName || (_profile as any)?.name || "guest";


  // ── Reload identity after Discord OAuth redirect ──────────────────────────
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("discord") === "1") {
      // Force re-read of profile from localStorage
      const newProfile = loadProfile();
      const newEffectiveId = getEffectivePlayerId(newProfile);
      // Clean URL
      const url = new URL(window.location.href);
      url.searchParams.delete("discord");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);


  React.useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const id = window.setTimeout(() => {
      if (countdown === 1) { setCountdown(null); setIsPlaying(true); setRunMessage(""); startAmbient(); }
      else { setCountdown(c => c !== null ? c - 1 : null); }
    }, 1000);
    return () => window.clearTimeout(id);
  }, [countdown]);

   dpadActionRef.current = handleTunnelAction;

  const getTunnelPlayerSprite = () => {
    if (hitFlash || hitShake) return "/tunnel/samurai/hit.png";
    if (didWinRun) return "/tunnel/samurai/win.png";
    if (lastRunResult && !lastRunResult.wasFullClear) return "/tunnel/samurai/death.png";

    if (!isPlaying) return "/tunnel/samurai/idle.png";

    if (facing === "left") return "/tunnel/samurai/left.png";
    if (facing === "right") return "/tunnel/samurai/right.png";

    return "/tunnel/samurai/run.png";
  };

  return (
    <>
          {countdown !== null && (
            <div style={{position:"fixed",inset:0,zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.55)",pointerEvents:"none"}}>
        <div style={{position:"absolute",inset:0,background:"linear-gradient(to bottom, rgba(9,12,22,0.15) 0%, rgba(9,12,22,0.5) 70%, rgba(9,12,22,0.88) 100%)",zIndex:0,pointerEvents:"none"}}/>
              <div style={{fontSize:140,fontWeight:900,color:"#fff",textShadow:"0 0 60px rgba(96,165,250,0.9)",lineHeight:1,userSelect:"none"}}>{countdown}</div>
            </div>
          )}
      {isPlaying && (
            <div style={{
              position:"fixed", top:0, left:0, right:0, zIndex:1000,
              display:"flex", justifyContent:"center", alignItems:"center", gap:24,
              padding:"8px 20px",
              background:"rgba(0,0,0,0.90)", backdropFilter:"blur(12px)",
              borderBottom:"2px solid "+themeMap[boardTheme].accent+"66",
              boxShadow:"0 4px 20px rgba(0,0,0,0.5)",
            }}>
              <span style={{color:"rgba(255,255,255,0.5)",fontWeight:700,fontSize:13,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{LAYOUT_NAMES[layoutIndex]||"#"+(layoutIndex+1)}</span>
          <span style={{color:timeLeft<=10?"#ff4444":themeMap[boardTheme].accent,fontWeight:900,fontSize:18,letterSpacing:1}}>⏱ {timeLeft}s</span>
              <span style={{color:themeMap[boardTheme].crystal,fontWeight:700,fontSize:16}}>💎 {score}</span>
              <span style={{color:"#ff8c00",fontWeight:700,fontSize:16}}>💥 {wallBreaksLeft}</span>
              <span style={{color:"rgba(255,255,255,0.6)",fontWeight:700,fontSize:14}}>💎 {crystals.length} left</span>
            </div>
          )}
            <main
        style={{
          maxWidth: 1600,
          margin: "0 auto",
          padding: isPlaying && isMobileView ? "10px 8px" : "20px 16px",
        }}
      >
        <header style={{ position:'relative', marginBottom:0, overflow:'hidden', minHeight:70 }}>
          <div style={{ position:'absolute', inset:0, backgroundImage:"url('/bg/tunnel-bg.png')", backgroundSize:'cover', backgroundPosition:'center', filter:'saturate(0.7) brightness(0.35)' }} />
          <div style={{ position:'absolute', inset:0, background:'linear-gradient(to bottom, rgba(5,8,18,0.5) 0%, rgba(2,4,12,0.85) 100%)' }} />
          <div style={{ position:'relative', zIndex:2, maxWidth:1200, margin:'0 auto', padding:'14px 20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <Link href="/" style={{ display:'flex', alignItems:'center', gap:10, textDecoration:'none', color:'white' }}>
              <span style={{ fontSize:20, filter:'drop-shadow(0 0 8px rgba(96,165,250,0.6))' }}>←</span>
              <span style={{ fontSize:11, fontWeight:900, letterSpacing:'0.2em', textTransform:'uppercase', color:'rgba(255,255,255,0.5)' }}>REBEL ANTS</span>
            </Link>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ fontSize:13, fontWeight:900, color:'#fbbf24' }}>⚡ {balance} <span style={{ fontSize:10, color:'rgba(251,191,36,0.6)' }}>REBEL</span></div>
              <button onPointerDown={e=>{e.preventDefault();toggleMute();}} style={{ background:'rgba(0,0,0,0.4)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:20, padding:'6px 12px', cursor:'pointer', fontSize:15, color:'rgba(255,255,255,0.8)', minWidth:40, minHeight:40 }}>
                {muted ? "🔇" : "🔊"}
              </button>
            </div>
          </div>
        </header>

              <div
          style={{
            ...cardStyle,
            ...(isPlaying && isMobileView ? mobileRunCardStyle : null),
          }}
        >
          {!(isPlaying && isMobileView) && (
<>
        {/* ── Floating particles ── */}
        <div style={{position:'fixed',inset:0,zIndex:0,pointerEvents:'none',overflow:'hidden'}}>
          {[...Array(20)].map((_,i) => (
            <div key={i} style={{
              position:'absolute',bottom:'-4px',left:`${(i*97+13)%100}%`,
              width:1+(i%2),height:2+(i%4),borderRadius:'50%',
              background:i%3===0?'#60a5fa':i%3===1?'#818cf8':'#93c5fd',
              opacity:0.08+(i%4)*0.04,
              animation:`tunnelFloat ${5+(i%5)*1.5}s ${(i*0.6)%7}s infinite linear`,
            }} />
          ))}
        </div>

        {/* ── Title ── */}
        <div style={{textAlign:'center',marginBottom:20,paddingTop:8}}>
          <div style={{fontSize:'clamp(26px,5vw,50px)',fontWeight:900,letterSpacing:'0.1em',textTransform:'uppercase',background:'linear-gradient(135deg,#e0f2fe,#93c5fd,#60a5fa,#3b82f6,#818cf8)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text',filter:'drop-shadow(0 0 24px rgba(96,165,250,0.5))'}}>🐜 ANT TUNNEL</div>
          <div style={{fontSize:11,letterSpacing:'0.25em',color:'rgba(255,255,255,0.35)',textTransform:'uppercase',marginTop:5}}>UNDERGROUND TUNNELS · CRUMBS · CRYSTALS · DANGER</div>
        </div>
        {/* ── Economy & Actions ── */}
        <div style={{maxWidth:900,margin:'0 auto 16px',padding:'0 4px'}}>
          <div style={{borderRadius:18,border:'1px solid rgba(96,165,250,0.15)',background:'linear-gradient(135deg,rgba(3,10,28,0.85),rgba(5,14,35,0.9))',backdropFilter:'blur(12px)',padding:'16px 20px',boxShadow:'0 0 30px rgba(96,165,250,0.06),inset 0 1px 0 rgba(96,165,250,0.08)'}}>
            {/* ── Plays & Daily Cap info ── */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10,marginBottom:8}}>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
              <div style={{padding:'6px 14px',borderRadius:20,background:'rgba(96,165,250,0.08)',border:'1px solid rgba(96,165,250,0.2)'}}>
                <span style={{fontSize:10,letterSpacing:'0.12em',textTransform:'uppercase',color:'rgba(255,255,255,0.4)',marginRight:6}}>PLAYS TODAY</span>
                <span style={{fontSize:14,fontWeight:900,color:'#93c5fd'}}>{remainingDaily}</span>
                <span style={{fontSize:10,color:'rgba(255,255,255,0.25)'}}> / {Number(dailyCap||0)}</span>
              </div>
              {capBank > 0 && (
                <div style={{padding:'6px 14px',borderRadius:20,background:'rgba(251,191,36,0.08)',border:'1px solid rgba(251,191,36,0.2)'}}>
                  <span style={{fontSize:10,letterSpacing:'0.12em',textTransform:'uppercase',color:'rgba(255,255,255,0.4)',marginRight:5}}>BONUS</span>
                  <span style={{fontSize:14,fontWeight:900,color:'#fbbf24'}}>+{capBank}</span>
                </div>
              )}
              {totalEarnRoom > 0 && (
                <div style={{padding:'6px 14px',borderRadius:20,background:'rgba(74,222,128,0.06)',border:'1px solid rgba(74,222,128,0.15)'}}>
                  <span style={{fontSize:10,letterSpacing:'0.12em',textTransform:'uppercase',color:'rgba(255,255,255,0.4)',marginRight:5}}>TOTAL LEFT</span>
                  <span style={{fontSize:14,fontWeight:900,color:'#4ade80'}}>{totalEarnRoom}</span>
                </div>
              )}
            </div>
            <button onClick={()=>void claimDailyNow()} disabled={dailyClaimed}
              style={{padding:'9px 20px',borderRadius:50,fontWeight:900,fontSize:12,letterSpacing:'0.1em',textTransform:'uppercase',cursor:dailyClaimed?'not-allowed':'pointer',background:dailyClaimed?'rgba(255,255,255,0.05)':'linear-gradient(135deg,#ef4444,#f97316)',border:dailyClaimed?'1px solid rgba(255,255,255,0.1)':'none',color:dailyClaimed?'rgba(255,255,255,0.3)':'white',boxShadow:dailyClaimed?'none':'0 0 16px rgba(239,68,68,0.35)',transition:'all 0.2s',whiteSpace:'nowrap'}}>
              {dailyClaimed?(countdownStr?`⏱ NEXT IN ${countdownStr}`:'✓ CLAIMED TODAY'):`⚡ CLAIM +${tunnelCfg.dailyClaim} REBEL`}
            </button>
          </div>
          <div style={{fontSize:10,color:'rgba(255,255,255,0.3)',lineHeight:1.5,marginBottom:4}}>
            🔄 Free plays reset daily · 💎 Buying REBEL raises your daily cap permanently + adds to your bonus bank (never expires)
          </div>
          {/* ── Action buttons ── */}
            <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',borderTop:'1px solid rgba(255,255,255,0.06)',paddingTop:12}}>
              {showDisconnect ? (
                <button onClick={()=>{const p=loadProfile();const fallback=(p as any)?.walletAddress?`wallet:${(p as any).walletAddress}`:(p?.id||"guest");saveProfile({...(p as any),discordUserId:undefined,discordName:undefined,primaryId:fallback} as any);window.location.href="/api/auth/discord/logout";}} style={{padding:'8px 16px',borderRadius:20,border:'1px solid rgba(96,165,250,0.3)',cursor:'pointer',fontWeight:700,fontSize:11,background:'rgba(96,165,250,0.08)',color:'#93c5fd',letterSpacing:'0.08em',textTransform:'uppercase'}}>✓ DISCORD</button>
              ) : (
                <button onClick={()=>{const p=loadProfile();saveProfile({...(p as any),discordSkipLink:false} as any);window.location.href="/api/auth/discord/login";}} style={{padding:'8px 16px',borderRadius:20,border:'none',cursor:'pointer',fontWeight:700,fontSize:11,background:'#5865F2',color:'white',letterSpacing:'0.08em',textTransform:'uppercase'}}>CONNECT DISCORD</button>
              )}
              <button onClick={()=>setShowBuyPoints(true)} style={{padding:'8px 16px',borderRadius:20,border:'1px solid rgba(251,191,36,0.3)',cursor:'pointer',fontWeight:700,fontSize:11,background:'rgba(251,191,36,0.08)',color:'#fbbf24',letterSpacing:'0.08em',textTransform:'uppercase'}}>💎 BUY POINTS</button>
              {showDisconnect && (<button onClick={()=>setDripPanelOpen(v=>!v)} style={{padding:'8px 16px',borderRadius:20,border:'1px solid rgba(255,255,255,0.12)',cursor:'pointer',fontWeight:700,fontSize:11,background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.5)',letterSpacing:'0.08em',textTransform:'uppercase'}}>MIGRATE DRIP</button>)}
              {showDisconnect && dripBalance !== null && (<div style={{fontSize:11,opacity:0.5,letterSpacing:'0.06em',textTransform:'uppercase'}}>DRIP: <b>{dripBalance}</b></div>)}
            </div>
          </div>
        </div>

        {/* ── DRIP migrate panel ── */}
        {dripPanelOpen && showDisconnect && (
          <div style={{maxWidth:900,margin:'0 auto 14px',padding:'0 4px'}}>
            <div style={{borderRadius:14,border:'1px solid rgba(255,255,255,0.12)',background:'rgba(5,10,25,0.95)',padding:'14px 16px'}}>
              <div style={{fontWeight:900,fontSize:14,marginBottom:8}}>Migrate DRIP Points → Game</div>
              <div style={{fontSize:12,opacity:0.8,marginBottom:10}}>This will <b>deduct</b> points from DRIP (Discord) and <b>credit</b> them into the game.</div>
              {dripBalance !== null && <div style={{fontSize:13,marginBottom:8}}>DRIP Balance: <b>{dripBalance}</b></div>}
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <label style={{fontSize:12,opacity:0.8}}>Amount:</label>
                <input type="number" min={1} value={dripAmount||""} onChange={e=>setDripAmount(Number(e.target.value))}
                  style={{width:100,padding:'6px 10px',borderRadius:10,border:'1px solid rgba(255,255,255,0.2)',background:'rgba(15,23,42,0.55)',color:'inherit',fontSize:15}} placeholder="e.g. 100" />
                <button disabled={dripBusy||!dripAmount} onClick={async()=>{
                  if(!dripAmount||dripAmount<=0)return;
                  setDripBusy(true);setDripStatus("");
                  try{
                    const idem=Date.now().toString(36);
                    const r=await fetch("/api/drip/migrate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({playerId:effectivePlayerId,amount:dripAmount,idempotencyKey:idem})});
                    const j=await r.json().catch(()=>null);
                    if(r.ok&&j?.ok){await refresh();setDripBalance(b=>b!==null?b-dripAmount:null);setDripStatus(`✅ Migrated ${dripAmount} points!`);setDripPanelOpen(false);setDripAmount(0);}
                    else setDripStatus(j?.error||"Migration failed.");
                  }catch(e:any){setDripStatus(e?.message||"Error.");}
                  finally{setDripBusy(false);}
                }} style={{padding:'8px 16px',borderRadius:14,border:'none',cursor:dripBusy?'default':'pointer',fontWeight:700,background:dripBusy?'rgba(255,255,255,0.1)':'#3b82f6',color:'white',opacity:dripBusy||!dripAmount?0.5:1}}>
                  {dripBusy?"Migrating…":`Migrate ${dripAmount}`}
                </button>
                <button onClick={()=>{setDripPanelOpen(false);setDripStatus("");}} style={{padding:'8px 12px',borderRadius:12,border:'1px solid rgba(255,255,255,0.15)',cursor:'pointer',background:'transparent',color:'rgba(255,255,255,0.6)'}}>Close</button>
              </div>
              {dripStatus && <div style={{marginTop:8,fontSize:12,fontWeight:700,color:dripStatus.includes("✅")?"#4ade80":"#f87171"}}>{dripStatus}</div>}
            </div>
          </div>
        )}

        {/* ── Layout chooser + Name row ── */}
        <div style={{maxWidth:900,margin:'0 auto 12px',padding:'0 4px',display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <button onClick={()=>{setLayoutMode("random");setSelectedLayout(null);}}
              style={{padding:'6px 14px',borderRadius:20,fontSize:11,fontWeight:800,cursor:'pointer',letterSpacing:'0.08em',
                border:layoutMode==="random"?'2px solid #60a5fa':'2px solid rgba(255,255,255,0.15)',
                background:layoutMode==="random"?'rgba(96,165,250,0.15)':'rgba(255,255,255,0.04)',
                color:layoutMode==="random"?'#93c5fd':'rgba(255,255,255,0.55)'}}>
              🎲 RANDOM
            </button>
            <button onClick={()=>setLayoutMode("pick")}
              style={{padding:'6px 14px',borderRadius:20,fontSize:11,fontWeight:800,cursor:'pointer',letterSpacing:'0.08em',
                border:layoutMode==="pick"?'2px solid #60a5fa':'2px solid rgba(255,255,255,0.15)',
                background:layoutMode==="pick"?'rgba(96,165,250,0.15)':'rgba(255,255,255,0.04)',
                color:layoutMode==="pick"?'#93c5fd':'rgba(255,255,255,0.55)'}}>
              🗺 CHOOSE LAYOUT
            </button>
            {layoutMode==="pick"&&selectedLayout!==null&&<span style={{fontSize:11,opacity:0.7,color:'#93c5fd'}}>#{selectedLayout+1} selected</span>}
          </div>
          <div style={{flex:1}} />
          <label style={{fontSize:12,opacity:0.8,display:'flex',alignItems:'center',gap:6}}>
            <span style={{letterSpacing:'0.08em',textTransform:'uppercase',fontSize:10,opacity:0.6}}>NAME</span>
            <input value={playerName} onChange={(e)=>{const v=(e.target.value.slice(0,18)||"guest").trim()||"guest";setPlayerName(v);const p=loadProfile();const id=(p?.id||"guest").trim()||"guest";saveProfile({name:v,id});}}
              style={inputStyle} />
          </label>
          <Link href="/tunnel-rules" style={{...tunnelRulesLinkStyle,fontSize:11,letterSpacing:'0.1em',textTransform:'uppercase',opacity:0.5}}>HOW TO PLAY</Link>
        </div>

        {/* ── Layout picker grid ── */}
        {layoutMode==="pick" && (
          <div style={{maxWidth:900,margin:'0 auto 12px',padding:'0 4px'}}>
            <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:6,padding:10,borderRadius:14,background:'rgba(0,0,0,0.4)',border:'1px solid rgba(96,165,250,0.12)'}}>
              {TUNNEL_LAYOUTS.map((layout,idx)=>{
                const ws=new Set(layout as string[]);const active=selectedLayout===idx;
                return(<button key={idx} onClick={()=>setSelectedLayout(idx)} title={LAYOUT_NAMES[idx]}
                  style={{padding:0,borderRadius:8,overflow:'hidden',border:active?'2px solid #60a5fa':'2px solid rgba(255,255,255,0.08)',background:active?'rgba(96,165,250,0.12)':'rgba(255,255,255,0.04)',cursor:'pointer',transition:'all 0.15s'}}>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(22,1fr)',padding:2}}>
                    {Array.from({length:14*22},(_,i)=>{const r=Math.floor(i/22),c=i%22;const w=r===0||r===13||c===0||c===21;const isWall=ws.has(`${r}:${c}`);return <div key={i} style={{aspectRatio:'1',background:w?'rgba(96,165,250,0.6)':isWall?'rgba(96,165,250,0.35)':'transparent'}} />;})}</div>
                  <div style={{fontSize:9,fontWeight:700,padding:'2px 3px 3px',textAlign:'center',color:active?'#93c5fd':'rgba(255,255,255,0.4)'}}>#{idx+1}</div>
                </button>);
              })}
            </div>
          </div>
        )}

        {/* ── Environment selector ── */}
        <div style={{maxWidth:900,margin:'0 auto 16px',padding:'0 4px'}}>
          <div style={{fontSize:10,fontWeight:900,letterSpacing:'0.25em',textTransform:'uppercase',color:'rgba(255,255,255,0.3)',marginBottom:10}}>SELECT YOUR TUNNEL ENVIRONMENT</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {(["colony","neon","mythic","lava","ice","golden","shadow","amber","toxic","void"] as BoardTheme[]).map(key=>{
              const d=DIFFICULTY[key];const th=themeMap[key];const active=boardTheme===key;
              return(
                <button key={key} onClick={()=>{setBoardTheme(key);setLayoutIndex(0);}}
                  style={{
                    padding:'10px 14px',borderRadius:14,cursor:'pointer',transition:'all 0.2s',
                    border:active?`2px solid ${th.accent}`:'2px solid rgba(255,255,255,0.1)',
                    background:active?`linear-gradient(135deg,${th.accent}18,${th.accent}08)`:'rgba(255,255,255,0.04)',
                    boxShadow:active?`0 0 16px ${th.accent}44,inset 0 0 20px ${th.accent}08`:'none',
                    transform:active?'scale(1.04)':'scale(1)',
                    display:'flex',flexDirection:'column',alignItems:'center',gap:4,minWidth:76,
                  }}>
                  <div style={{fontSize:20,filter:active?`drop-shadow(0 0 8px ${th.accent})`:'none'}}>{d.emoji}</div>
                  <div style={{fontSize:10,fontWeight:900,letterSpacing:'0.08em',textTransform:'uppercase',color:active?th.accent:'rgba(255,255,255,0.65)',lineHeight:1.2,textAlign:'center'}}>{d.label}</div>
                  {active && <div style={{fontSize:9,color:'rgba(255,255,255,0.5)',textAlign:'center',lineHeight:1.3,maxWidth:80}}>{d.desc}</div>}
                  <div style={{width:20,height:3,borderRadius:4,background:active?th.accent:'rgba(255,255,255,0.1)',marginTop:2,transition:'all 0.2s'}} />
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Identity display ── */}
        {discordUserId && (
          <div style={{maxWidth:900,margin:'0 auto 8px',padding:'0 4px',display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:10,opacity:0.4}}>
            <span>ID: {identityDisplay}</span>
            <button onClick={()=>setShowRules(true)} style={{fontSize:10,textDecoration:'underline',opacity:0.6,background:'transparent',border:'none',color:'inherit',cursor:'pointer'}}>Official Rules</button>
          </div>
        )}
      </>
          )}

          {isPlaying && isMobileView && (
            <div style={mobileRunTopBarStyle}>
              <div style={mobileRunStatPillStyle}>⏱ {timeLeft}s</div>
              <div style={mobileRunStatPillStyle}>🎯 {score}</div>
              <div style={mobileRunStatPillStyle}>🧱 {wallBreaksLeft}</div>
              <div style={mobileRunStatPillStyle}>💎 {crystals.length}</div>
            </div>
          )}

                   <div ref={gameBoardTopRef} style={gameBoardWrapStyle}>
            <div style={gameBoardStyle}>
              <div style={boardHeaderStyle}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 900 }}>{theme.name}</div>
            <div style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,0.55)",marginBottom:2}}>🗺️ {LAYOUT_NAMES[layoutIndex]||"Layout #"+(layoutIndex+1)}</div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
              <span style={{background:themeMap[boardTheme].accent+"22",border:"1px solid "+themeMap[boardTheme].accent+"66",color:themeMap[boardTheme].accent,borderRadius:12,padding:"2px 10px",fontSize:11,fontWeight:700}}>
                {DIFFICULTY[boardTheme].emoji} {DIFFICULTY[boardTheme].label}
              </span>
              <span style={{fontSize:11,opacity:0.6,fontStyle:"italic"}}>{DIFFICULTY[boardTheme].desc}</span>
            </div>
                  <div style={{ fontSize: 13, opacity: 0.82 }}>
                                       Desktop: arrow keys move, Space breaks. Mobile: swipe to move, tap Break to smash walls.
                  </div>

                                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button
                        onClick={() => { void startRun(); }}
                        disabled={isPlaying}
                        style={{...startRunButtonStyle, opacity: isPlaying ? 0.4 : 1, cursor: isPlaying ? 'default' : 'pointer', fontSize: isPlaying ? 13 : 15, padding: isPlaying ? '10px 14px' : '12px 20px'}}
                      >
                        {isPlaying ? "Running..." : "▶ START RUN (1 play)"}
                      </button>

                    <div style={statusPillStyle}>
                      ⏱ Time: <b>{timeLeft}s</b>
                    </div>

                    <div style={statusPillStyle}>
                      🎯 Score: <b>{score}</b>
                    </div>

                    <div style={statusPillStyle}>
                      🧱 Wall Break Charges: <b>{wallBreaksLeft}</b> / {tunnelCfg.tunnelWallBreaks}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 14,
                      flexWrap: "wrap",
                      marginTop: 8,
                      fontSize: 12,
                      opacity: 0.85,
                    }}
                  >
                    <span>🍞 Crumb = 1</span>
                    <span>🍬 Sugar = 5</span>
                    <span>💎 Crystal = 20</span>
                    <span>🕷️ Hit = -3 sec</span>
                    <span>Collect all crystals to win early</span>
                  </div>
                </div>


                <div style={boardBadgeStyle}>
                  Cost: {tunnelCfg.tunnelCost}
                </div>
              </div>

              <div style={{ padding: "12px 18px 18px" }}>
               {runMessage ? (
  <div
    style={{
      ...runMessageStyle,
      border: didWinRun
        ? "1px solid rgba(250,204,21,0.35)"
        : runMessageStyle.border,
      background: didWinRun
        ? "rgba(250,204,21,0.10)"
        : runMessageStyle.background,
      color: didWinRun ? "#fde68a" : "white",
      fontWeight: didWinRun ? 800 : 500,
    }}>
          
    {runMessage}
  </div>
) : null}
                                                                            <div
                  ref={boardScrollRef}
                  className={hitShake ? "hitShake" : ""}
                  onTouchStart={handleSwipeStart}
                  onTouchMove={handleSwipeMove}
                  onTouchEnd={handleSwipeEnd}
                  style={{
                    ...boardPreviewStyle,
                    ...(isMobileView ? boardPreviewMobileStyle : null),
                    ...(isPlaying && isMobileView ? boardPreviewMobileRunStyle : null),
          ...(isPlaying && isMobileView && isLandscape ? { height: "calc(100svh - 80px)", minHeight: "calc(100svh - 80px)", maxHeight: "calc(100svh - 80px)" } : null),
                    background: theme.bg,
                    overflow: isPlaying && isMobileView ? "hidden" : undefined,
                    touchAction: isPlaying && isMobileView ? "none" : undefined,
                  }}
                >
                                   <div style={previewGlowStyle(theme.accent)} />

        {/* portrait supported via D-pad */}

                 {hitFlash && (
  <div
    className="hitFlash"
    style={{
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      zIndex: 4,
      background:
        "radial-gradient(circle at center, rgba(255,70,70,0.62), rgba(180,20,20,0.38) 42%, rgba(80,0,0,0.16) 68%, transparent 78%)",
      mixBlendMode: "screen",
    }}
  />
)}

                                                                    <div
                    style={{
                      ...previewInnerStyle,
                      ...(isMobileView ? previewInnerMobileStyle : null),
                      ...(isPlaying && isMobileView ? previewInnerMobileRunStyle : null),
                    }}
                  >
                    <div
                      style={{
                        ...previewGridStyle,
                        ...(isMobileView ? previewGridMobileStyle : null),
                        ...(isPlaying && isMobileView ? previewGridMobileRunStyle : null),
                      }}
                    >
                    {Array.from({ length: GRID_ROWS * GRID_COLS }, (_, i) => {
                      const row = Math.floor(i / GRID_COLS);
                      const col = i % GRID_COLS;

                                           const wall = isWall(row, col, brokenWallSet, layoutIndex);
                      const hasCrumb = crumbs.some((c) => c.row === row && c.col === col);
                      const hasSugar = sugars.some((c) => c.row === row && c.col === col);
                      const hasCrystal = crystals.some((c) => c.row === row && c.col === col);
                                                                  const isPlayer = playerPos.row === row && playerPos.col === col;
                      const isSpider = spiderPos?.row === row && spiderPos?.col === col;
                      const burst = pickupBursts.find((b) => b.row === row && b.col === col);
                      const wallBurst = wallBursts.find((b) => b.row === row && b.col === col);

                      return (
                                               <div
                          key={i}
                          ref={isPlayer ? playerTileRef : null}
                          style={{
                            ...tileStyle,
                            background: wall ? theme.wall : theme.floor,
                            border: wall
                              ? "1px solid rgba(255,255,255,0.05)"
                              : "1px solid rgba(255,255,255,0.03)",
                            boxShadow: wall
                              ? "inset 0 0 14px rgba(0,0,0,0.28)"
                              : "inset 0 0 8px rgba(255,255,255,0.02)",
                          }}
                        >
                   {!wall && hasCrumb && (
  <div
    className="crumbPulse"
    style={{
      width: isMobileView ? 12 : 16,
      height: isMobileView ? 12 : 16,
      display: "grid",
      placeItems: "center",
      borderRadius: "40% 60% 55% 45%",
      background: "#22c55e",
      boxShadow: isMobileView
        ? "0 0 6px #22c55e, 0 0 12px rgba(34,197,94,0.45)"
        : "0 0 10px #22c55e, 0 0 20px rgba(34,197,94,0.6)",
      transform: "rotate(15deg)",
      fontSize: isMobileView ? 8 : 10,
      filter: isMobileView
        ? "drop-shadow(0 0 4px rgba(34,197,94,0.6))"
        : "drop-shadow(0 0 6px rgba(34,197,94,0.8))",
    }}
  >
    🍞
  </div>
)}

                                               {!wall && hasSugar && (
  <div
    className="sugarPulse"
    style={{
      width: isMobileView ? 16 : 20,
      height: isMobileView ? 16 : 20,
      display: "grid",
      placeItems: "center",
      borderRadius: "50%",
      background: "radial-gradient(circle at 30% 30%, #fff7cc, #facc15)",
      boxShadow: isMobileView
        ? "0 0 10px #facc15, 0 0 18px rgba(250,204,21,0.45)"
        : "0 0 16px #facc15, 0 0 30px rgba(250,204,21,0.6)",
      border: "1px solid rgba(255,255,255,0.4)",
      fontSize: isMobileView ? 10 : 12,
      filter: isMobileView
        ? "drop-shadow(0 0 6px rgba(250,204,21,0.7))"
        : "drop-shadow(0 0 10px rgba(250,204,21,0.9))",
    }}
  >
    🍬
  </div>
)}

{!wall && hasCrystal && (
  <div
    className="crystalPulse"
    style={{
      width: isMobileView ? 20 : 26,
      height: isMobileView ? 20 : 26,
      display: "grid",
      placeItems: "center",
      fontSize: isMobileView ? 13 : 16,
      filter: isMobileView
        ? `
          drop-shadow(0 0 4px #3b82f6)
          drop-shadow(0 0 8px #3b82f6)
          drop-shadow(0 0 16px rgba(59,130,246,0.8))
        `
        : `
          drop-shadow(0 0 6px #3b82f6)
          drop-shadow(0 0 14px #3b82f6)
          drop-shadow(0 0 28px rgba(59,130,246,1))
        `,
    }}
  >
    💎
  </div>
)}

                                                                         {!wall && burst && (
                            <div
                              className="pickupBurst"
                              style={{
                                position: "absolute",
                                inset: 0,
                                display: "grid",
                                placeItems: "center",
                                pointerEvents: "none",
                                zIndex: 1,
                              }}
                            >
                              <div
                                style={{
                                  width: 34,
                                  height: 34,
                                  borderRadius: 999,
                                  background: `${burstColor(burst.kind)}22`,
                                  boxShadow: `0 0 10px ${burstColor(burst.kind)}, 0 0 24px ${burstColor(burst.kind)}`,
                                  border: `1px solid ${burstColor(burst.kind)}66`,
                                }}
                              />
                            </div>
                          )}

                          {wallBurst && (
                            <div
                              className="wallBurst"
                              style={{
                                position: "absolute",
                                inset: 0,
                                display: "grid",
                                placeItems: "center",
                                pointerEvents: "none",
                                zIndex: 1,
                              }}
                            >
                              <div
                                style={{
                                  width: 38,
                                  height: 38,
                                  borderRadius: 999,
                                  background: "rgba(180, 120, 60, 0.18)",
                                  boxShadow:
                                    "0 0 10px rgba(180,120,60,0.45), 0 0 24px rgba(120,70,30,0.55)",
                                  border: "1px solid rgba(210,160,90,0.45)",
                                }}
                              />
                            </div>
                          )}

                                                                            {!wall && isSpider && (
                            <div
                              className="spiderBob"
                              style={{
                                ...tokenStyle,
                                width: isMobileView ? 34 : 44,
                                height: isMobileView ? 34 : 44,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                pointerEvents: "none",
                                overflow: "visible",
                              }}
                            >
                              <img
                                src="/spiders/spider.png"
                                alt="Spider"
                                style={{
                                  width: isMobileView ? "125%" : "145%",
                                  height: isMobileView ? "125%" : "145%",
                                  objectFit: "contain",
                                  transform: "translateY(2px)",
                                  filter: isMobileView
                                    ? "drop-shadow(0 0 4px rgba(0,0,0,0.45)) drop-shadow(0 0 6px rgba(255,40,40,0.45))"
                                    : "drop-shadow(0 0 6px rgba(0,0,0,0.5)) drop-shadow(0 0 10px rgba(255,40,40,0.65)) drop-shadow(0 0 18px rgba(255,0,0,0.55))",
                                }}
                              />
                            </div>
                          )}

                                                                                                    {!wall && isPlayer && (
                            <div
                              className="antFloat"
                              style={{
                                ...tokenStyle,
                                width: isMobileView ? 34 : 42,
                                height: isMobileView ? 34 : 42,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                pointerEvents: "none",
                                overflow: "visible",
                              }}
                            >
                              <img
                                                             src={getTunnelPlayerSprite()}
                                alt="Samurai Ant"
                                                                                               style={{
                                  width: isMobileView ? "135%" : "155%",
                                  height: isMobileView ? "135%" : "155%",
                                  objectFit: "contain",
                                  transform: "translateY(3px) scale(1.55)",
                                  transformOrigin: "center center",
                                  filter: isMobileView
                                    ? "drop-shadow(0 0 4px rgba(0,0,0,0.35))"
                                    : "drop-shadow(0 0 6px rgba(0,0,0,0.45)) drop-shadow(0 0 10px rgba(255,255,255,0.12))",
                                }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                            </div>
              </div>
            </div>

        {isPlaying && isMobileView && (
          <div style={{ position:"fixed", ...(isLandscape ? { right:"max(12px,env(safe-area-inset-right))", top:"50%", transform:"translateY(-50%)" } : { bottom:"max(16px,env(safe-area-inset-bottom))", left:"50%", transform:"translateX(-50%)" }), zIndex:500, display:"flex", flexDirection:"column", alignItems:"center", gap:8, userSelect:"none", WebkitUserSelect:"none", touchAction:"none" }}>
            {/* D-pad */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, width:168, height:168 }}>
              <div />
              <button type="button" onTouchStart={e=>{e.preventDefault();startDpadRepeat("up");}} onTouchEnd={e=>{e.preventDefault();stopDpadRepeat();}} onTouchCancel={stopDpadRepeat} onMouseDown={e=>{e.preventDefault();startDpadRepeat("up");}} onMouseUp={stopDpadRepeat} onMouseLeave={stopDpadRepeat} style={{ display:"flex",alignItems:"center",justifyContent:"center",borderRadius:12,border:"2px solid rgba(255,255,255,0.3)",background:"rgba(255,255,255,0.12)",fontSize:28,cursor:"pointer",color:"white",WebkitTapHighlightColor:"transparent",touchAction:"none",outline:"none" }}>▲</button>
              <div />
              <button type="button" onTouchStart={e=>{e.preventDefault();startDpadRepeat("left");}} onTouchEnd={e=>{e.preventDefault();stopDpadRepeat();}} onTouchCancel={stopDpadRepeat} onMouseDown={e=>{e.preventDefault();startDpadRepeat("left");}} onMouseUp={stopDpadRepeat} onMouseLeave={stopDpadRepeat} style={{ display:"flex",alignItems:"center",justifyContent:"center",borderRadius:12,border:"2px solid rgba(255,255,255,0.3)",background:"rgba(255,255,255,0.12)",fontSize:28,cursor:"pointer",color:"white",WebkitTapHighlightColor:"transparent",touchAction:"none",outline:"none" }}>◀</button>
              <div style={{ borderRadius:12, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)" }} />
              <button type="button" onTouchStart={e=>{e.preventDefault();startDpadRepeat("right");}} onTouchEnd={e=>{e.preventDefault();stopDpadRepeat();}} onTouchCancel={stopDpadRepeat} onMouseDown={e=>{e.preventDefault();startDpadRepeat("right");}} onMouseUp={stopDpadRepeat} onMouseLeave={stopDpadRepeat} style={{ display:"flex",alignItems:"center",justifyContent:"center",borderRadius:12,border:"2px solid rgba(255,255,255,0.3)",background:"rgba(255,255,255,0.12)",fontSize:28,cursor:"pointer",color:"white",WebkitTapHighlightColor:"transparent",touchAction:"none",outline:"none" }}>▶</button>
              <div />
              <button type="button" onTouchStart={e=>{e.preventDefault();startDpadRepeat("down");}} onTouchEnd={e=>{e.preventDefault();stopDpadRepeat();}} onTouchCancel={stopDpadRepeat} onMouseDown={e=>{e.preventDefault();startDpadRepeat("down");}} onMouseUp={stopDpadRepeat} onMouseLeave={stopDpadRepeat} style={{ display:"flex",alignItems:"center",justifyContent:"center",borderRadius:12,border:"2px solid rgba(255,255,255,0.3)",background:"rgba(255,255,255,0.12)",fontSize:28,cursor:"pointer",color:"white",WebkitTapHighlightColor:"transparent",touchAction:"none",outline:"none" }}>▼</button>
              <div />
            </div>
            {/* Break */}
            <button type="button" onTouchStart={pressMobileBreak} onMouseDown={pressMobileBreak} style={mobileBreakButtonStyle}>Break</button>
          </div>
        )}
          </div>

    {!isPlaying && lastRunResult && (
      <div style={{margin:"12px 0",padding:"14px 16px",borderRadius:14,border:lastRunResult.wasFullClear?"1px solid rgba(250,204,21,0.4)":"1px solid rgba(255,255,255,0.1)",background:lastRunResult.wasFullClear?"rgba(250,204,21,0.08)":"rgba(255,255,255,0.04)"}}>
        <div style={{fontSize:11,fontWeight:800,opacity:0.5,letterSpacing:"0.06em",marginBottom:8}}>{lastRunResult.wasFullClear?"💎 CRYSTAL SWEEP COMPLETE":"⏱ RUN COMPLETE"}</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:10,alignItems:"center"}}>
          <div style={{fontSize:13,fontWeight:900,color:"#fde68a"}}>🗺️ #{lastRunResult.layoutNum} {lastRunResult.layoutName}</div>
          <div style={{fontSize:13,fontWeight:700,color:"#93c5fd"}}>🎯 {lastRunResult.score.toLocaleString()} pts</div>
          {lastRunResult.clearTimeMs!==null && <div style={{fontSize:13,fontWeight:700,color:"#fbbf24"}}>⚡ {formatMs(lastRunResult.clearTimeMs)}</div>}
          {lastRunResult.wasFullClear && personalStats?.bestClearTimeMs && lastRunResult.clearTimeMs!==null && lastRunResult.clearTimeMs<=personalStats.bestClearTimeMs && <div style={{fontSize:11,fontWeight:800,color:"#fde68a",background:"rgba(250,204,21,0.15)",border:"1px solid rgba(250,204,21,0.3)",borderRadius:8,padding:"2px 8px"}}>🏆 PB!</div>}
        </div>
      </div>
    )}
          <div style={tunnelLeaderboardWrapStyle}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
              <div><div style={{fontSize:20,fontWeight:900}}>🏆 Tunnel Leaderboards</div><div style={{fontSize:12,opacity:0.55,marginTop:2}}>Top 3 scores &amp; fastest clears per layout — 31 maps total</div></div>
              <button onClick={()=>void loadTunnelLeaderboard()} style={{padding:"6px 12px",borderRadius:20,border:"1px solid rgba(255,255,255,0.15)",background:"rgba(255,255,255,0.06)",cursor:"pointer",fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.7)"}}>↻ Refresh</button>
            </div>
            <div style={{marginTop:14}}>
      <div style={{fontSize:13,fontWeight:800,opacity:0.6,marginBottom:10,letterSpacing:"0.06em"}}>🗺️ LAYOUT LEADERBOARDS — 31 MAPS</div>
      <div style={{maxHeight:isMobileView?480:520,overflowY:"auto",paddingRight:4,scrollbarWidth:"thin"}}>
      <div style={{display:"grid",gridTemplateColumns:isMobileView?"1fr":"repeat(2,1fr)",gap:10}}>
        {layoutChampions.map((lc,idx)=>{
          const hasScores=lc.topScores&&lc.topScores.length>0;
          const hasClears=lc.fastestClears&&lc.fastestClears.length>0;
          const layoutLabel=lc.layoutName||(lc.layoutIndex===30?"#31":"Layout "+(lc.layoutIndex+1));
          return(
          <div key={idx} style={{borderRadius:12,border:"1px solid rgba(255,255,255,0.08)",background:"rgba(0,0,0,0.35)",overflow:"hidden"}}>
            <div style={{padding:"8px 12px",background:"rgba(255,255,255,0.04)",borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:12,fontWeight:900,color:"#fde68a"}}>#{lc.layoutIndex+1} {layoutLabel}</span>
              <span style={{fontSize:10,opacity:0.4}}>Top 3</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:0}}>
              <div style={{padding:"8px 10px",borderRight:"1px solid rgba(255,255,255,0.05)"}}>
                <div style={{fontSize:10,fontWeight:800,color:"#60a5fa",marginBottom:6,letterSpacing:"0.05em"}}>🏆 SCORES</div>
                {!hasScores
                  ?<div style={{fontSize:10,opacity:0.35,fontStyle:"italic"}}>Open</div>
                  :lc.topScores.slice(0,3).map((e:any,i:number)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:4,marginBottom:3}}>
                      <span style={{fontSize:10,minWidth:16}}>{i===0?"🥇":i===1?"🥈":"🥉"}</span>
                      <span style={{fontSize:10,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",opacity:0.8}}>{e.playerName||e.playerId||"guest"}</span>
                      <span style={{fontSize:10,fontWeight:800,color:"#93c5fd"}}>{Number(e.score).toLocaleString()}</span>
                    </div>
                  ))
                }
              </div>
              <div style={{padding:"8px 10px"}}>
                <div style={{fontSize:10,fontWeight:800,color:"#fbbf24",marginBottom:6,letterSpacing:"0.05em"}}>⚡ FASTEST</div>
                {!hasClears
                  ?<div style={{fontSize:10,opacity:0.35,fontStyle:"italic"}}>Open</div>
                  :lc.fastestClears.slice(0,3).map((e:any,i:number)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:4,marginBottom:3}}>
                      <span style={{fontSize:10,minWidth:16}}>{i===0?"🥇":i===1?"🥈":"🥉"}</span>
                      <span style={{fontSize:10,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",opacity:0.8}}>{e.playerName||e.playerId||"guest"}</span>
                      <span style={{fontSize:10,fontWeight:800,color:"#fde68a"}}>{formatMs(e.clearTimeMs)}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
          );
        })}
      </div>
    </div>
      </div>
    <div style={{...leaderboardCardRedStyle,marginTop:14}}>
              <div style={leaderboardCardHeaderStyle}>
                <div><div style={{...leaderboardTitleStyle,color:"#f87171"}}>🐜 Your Stats</div><div style={leaderboardSubtitleStyle}>Your personal progress. Only you can see this.</div></div>
                <div style={leaderboardBadgeRedStyle}>YOU</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:isMobileView?"repeat(2,1fr)":"repeat(5,1fr)",gap:12,marginBottom:14}}>
                <div style={personalStatBoxStyle("#60a5fa")}><div style={personalStatLabelStyle}>🎯 Best Score</div><div style={personalStatValueStyle}>{Number(personalStats?.bestScore||0).toLocaleString()}</div></div>
                <div style={personalStatBoxStyle("#facc15")}><div style={personalStatLabelStyle}>⚡ Best Clear</div><div style={personalStatValueStyle}>{personalStats?.bestClearTimeMs?formatMs(personalStats.bestClearTimeMs):"--"}</div></div>
                <div style={personalStatBoxStyle("#22c55e")}><div style={personalStatLabelStyle}>🏃 Total Runs</div><div style={personalStatValueStyle}>{Number(personalStats?.totalRuns||0).toLocaleString()}</div></div>
                <div style={personalStatBoxStyle("#f43f5e")}><div style={personalStatLabelStyle}>💎 Crystals</div><div style={personalStatValueStyle}>{Number(personalStats?.totalCrystals||0).toLocaleString()}</div></div>
                <div style={personalStatBoxStyle("#a78bfa")}><div style={personalStatLabelStyle}>🗺️ Layouts</div><div style={personalStatValueStyle}>{layoutsExplored}<span style={{fontSize:12,opacity:0.5}}>/30</span></div></div>
              </div>
              <div style={{padding:"10px 12px",borderRadius:12,background:"rgba(167,139,250,0.08)",border:"1px solid rgba(167,139,250,0.2)"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{fontSize:12,fontWeight:700,color:"#a78bfa"}}>🗺️ Explorer Progress</span><span style={{fontSize:12,opacity:0.6}}>{layoutsExplored} / 30 layouts played</span></div>
                <div style={{height:7,borderRadius:99,background:"rgba(255,255,255,0.08)"}}><div style={{height:"100%",borderRadius:99,width:(Math.min(100,(layoutsExplored/30)*100))+"%",background:"linear-gradient(90deg,#7c3aed,#a78bfa)",transition:"width 0.6s ease"}}/></div>
                <div style={{fontSize:10,opacity:0.5,marginTop:4}}>Play any run on a layout to mark it explored</div>
                {layoutsExplored===30&&<div style={{marginTop:4,fontSize:12,fontWeight:800,color:"#fde68a",textAlign:"center"}}>🏆 All 30 layouts conquered! Legend status. 🐜</div>}
              </div>
            </div>
          </div>
          </div>
        {/* landscape prompt removed — D-pad supports portrait */}
        {/* Polished landscape-only overlay */}
        {isMobileView && !isLandscape && isPlaying && (
          <div style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(9,12,22,0.96)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20, padding:32 }}>
            <div style={{ fontSize:64, animation:"spin90 1.2s ease-in-out infinite alternate" }}>📱</div>
            <div style={{ fontSize:22, fontWeight:900, color:"white", textAlign:"center", letterSpacing:"0.02em" }}>Rotate to play</div>
            <div style={{ fontSize:14, color:"rgba(255,255,255,0.5)", textAlign:"center", maxWidth:260 }}>Ant Tunnel is best in landscape mode</div>
            <div style={{ fontSize:36, opacity:0.3 }}>🐜</div>
          </div>
        )}
      </main>
      {showRules && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", zIndex:3000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={()=>setShowRules(false)}>
          <div style={{ background:"#0f172a", border:"1px solid rgba(255,255,255,0.15)", borderRadius:16, padding:28, maxWidth:560, width:"100%", maxHeight:"85vh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
              <div style={{ fontWeight:900, fontSize:18 }}>📋 Official Rules</div>
              <button onClick={()=>setShowRules(false)} style={{ background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)", borderRadius:8, padding:"6px 14px", color:"white", cursor:"pointer", fontSize:13 }}>✕ Close</button>
            </div>
            <div style={{ fontSize:13, lineHeight:1.7, display:"flex", flexDirection:"column", gap:12, opacity:0.9 }}>
              <p><b>Free-to-play.</b> No purchase necessary to play. Void where prohibited.</p>
              <p><b>Game currency:</b> REBEL Points are an in-app promotional points system. No guaranteed cash value, not redeemable for cash.</p>
              <p><b>Optional purchase (APE):</b> You may optionally buy REBEL Points using APE to support the project. <b>All purchases are final</b> (no refunds). Gas fees may apply.</p>
              <p><b>Prizes:</b> Crates may award REBEL Points and/or digital collectibles and/or merch (when available). Availability may vary by location.</p>
              <p><b>Daily limits:</b> Daily claim and play limits apply to ensure fair access. Daily plays reset every 24 hours. Purchased bonus plays do not expire.</p>
              <p><b>Fair play:</b> Multi-accounting, bots, exploits, or abuse may result in disqualification, prize forfeiture, or account blocking.</p>
              <p><b>Odds:</b> Prize odds and point values may change over time based on live configuration and promotions.</p>
              <p><b>Taxes:</b> You are responsible for any taxes associated with prizes, if applicable.</p>
              <p style={{ opacity:0.7 }}>By playing, you agree to these rules and acknowledge this is an entertainment experience with promotional rewards.</p>
            </div>
          </div>
        </div>
      )}

      <BuyPointsModal
        open={showBuyPoints}
        onClose={() => setShowBuyPoints(false)}
        playerId={effectivePlayerId}
        onClaimed={async () => {
          await refresh();
        }}
      />

      {/* Copyright */}
      <div style={{ textAlign:"center", padding:"10px 0 6px", fontSize:10, opacity:0.28, color:"white", letterSpacing:"0.05em", userSelect:"none", pointerEvents:"none" }}>
        © 2026 Rebel Ants LLC · Developed by Miguel Concepcion
      </div>
      <style jsx>{`
        .crumbPulse {
          animation: crumbPulse 1.15s ease-in-out infinite;
        }

        .sugarPulse {
          animation: sugarPulse 1.35s ease-in-out infinite;
        }

        .crystalPulse {
          animation: crystalPulse 1.6s ease-in-out infinite;
        }

        .antFloat {
          animation: antFloat 1.3s ease-in-out infinite;
        }

                      .spiderBob {
          animation: spiderBob 0.9s ease-in-out infinite;
        }

        .pickupBurst {
          animation: pickupBurst 0.26s ease-out forwards;
        }

        .wallBurst {
          animation: wallBurst 0.26s ease-out forwards;
        }

                .hitFlash {
          animation: hitFlash 0.22s ease-out forwards;
        }

             .hitShake {
          animation: hitShake 0.18s linear;
        }

                             .mobileOnlyControls {
          display: none;
        }

        @media (max-width: 900px) {
          .mobileOnlyControls {
            position: fixed;
            bottom: max(16px, env(safe-area-inset-bottom));
            left: 50%;
            transform: translateX(-50%);
            z-index: 120;
            display: flex;
            flex-direction: column;
            align-items: center;
          }
        }

        @keyframes crumbPulse {
          0% { transform: scale(1); opacity: 0.88; }
          50% { transform: scale(1.18); opacity: 1; }
          100% { transform: scale(1); opacity: 0.88; }
        }

        @keyframes sugarPulse {
          0% { transform: scale(1); opacity: 0.9; }
          50% { transform: scale(1.14); opacity: 1; }
          100% { transform: scale(1); opacity: 0.9; }
        }

        @keyframes crystalPulse {
          0% { transform: rotate(45deg) scale(1); opacity: 0.86; }
          50% { transform: rotate(45deg) scale(1.16); opacity: 1; }
          100% { transform: rotate(45deg) scale(1); opacity: 0.86; }
        }

        @keyframes antFloat {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-2px); }
          100% { transform: translateY(0px); }
        }

              @keyframes spiderBob {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-1px); }
          100% { transform: translateY(0px); }
        }

              @keyframes pickupBurst {
          0% {
            transform: scale(0.65);
            opacity: 0.95;
          }
          100% {
            transform: scale(1.45);
            opacity: 0;
          }
        }

        @keyframes wallBurst {
          0% {
            transform: scale(0.55);
            opacity: 0.95;
          }
          100% {
            transform: scale(1.55);
            opacity: 0;
          }
        }

     @keyframes hitFlash {
  0% {
    opacity: 1;
    transform: scale(1);
  }
  35% {
    opacity: 0.95;
    transform: scale(1.045);
  }
  100% {
    opacity: 0;
    transform: scale(1);
  }
}

@keyframes hitShake {
  0% { transform: translate(0, 0); }
  20% { transform: translate(-4px, 2px); }
  40% { transform: translate(4px, -2px); }
  60% { transform: translate(-3px, 1px); }
  80% { transform: translate(3px, -1px); }
  100% { transform: translate(0, 0); }
}
        @keyframes spin90 {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(90deg); }
        }
      `}</style>
    </>
  );
}

const cardStyle: React.CSSProperties = {
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(15,23,42,0.88)",
  boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
  padding: 20,
  color: "white",

};

const tabStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "8px 12px",
  borderRadius: 999,
  textDecoration: "none",
  color: "white",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.16)",
};

const tabActiveStyle: React.CSSProperties = {
  ...tabStyle,
  background: "rgba(96,165,250,0.18)",
};

const statsWrapStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "center",
  fontSize: 13,
  opacity: 0.95,
};

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,.18)",
  background: "rgba(15,23,42,.55)",
  color: "white",
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(15,23,42,0.7)",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

const themeSwitchWrapStyle: React.CSSProperties = {
  marginTop: 18,
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  alignItems: "center",
};

const themeButtonStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.05)",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

function themeButtonActiveStyle(color: string): React.CSSProperties {
  return {
    ...themeButtonStyle,
    border: `1px solid ${color}55`,
    background: `${color}22`,
    boxShadow: `0 0 14px ${color}22`,
  };
}

const gameBoardWrapStyle: React.CSSProperties = {
  marginTop: 22,
};

const gameBoardStyle: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(10,14,26,0.95)",
  overflow: "hidden",
};

const boardHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  padding: "12px 14px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  position: "sticky",
  top: 0,
  zIndex: 20,
  background: "rgba(10,14,26,0.97)",
  backdropFilter: "blur(8px)",
};

const boardBadgeStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 800,
  background: "rgba(250,204,21,0.14)",
  border: "1px solid rgba(250,204,21,0.22)",
  color: "#fde68a",
};

const startRunButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  fontWeight: 800,
  background: "rgba(34,197,94,0.18)",
  border: "1px solid rgba(34,197,94,0.38)",
  color: "#86efac",
  cursor: "pointer",
};

const statusPillStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  fontSize: 13,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.10)",
};

const runMessageStyle: React.CSSProperties = {
  marginBottom: 12,
  padding: "10px 12px",
  borderRadius: 12,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.10)",
  fontSize: 13,
  opacity: 0.95,
};

const mobileRunCardStyle: React.CSSProperties = {
  padding: 10,
  minHeight: "100dvh",
};

const mobileRunTopBarStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: 10,
};

const mobileRunStatPillStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 12,
  fontSize: 13,
  fontWeight: 800,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.10)",
};

const boardPreviewStyle: React.CSSProperties = {
  position: "relative",
  overflow: "auto",
  borderRadius: 18,
  padding: 14,
  height: "60vh",
  minHeight: 520,
  maxHeight: 720,
  scrollBehavior: "smooth",
  overscrollBehavior: "contain",
};

const boardPreviewMobileStyle: React.CSSProperties = {
  padding: 10,
  height: "62vh",
  minHeight: 420,
  maxHeight: 560,
};

const previewInnerMobileStyle: React.CSSProperties = {
  minWidth: "100%",
  width: "100%",
  minHeight: 0,
};

const previewGridMobileStyle: React.CSSProperties = {
  gap: 6,
};

const boardPreviewMobileRunStyle: React.CSSProperties = {
  padding: 8,
  height: "calc(100dvh - 360px)",
  minHeight: "calc(100dvh - 360px)",
  maxHeight: "calc(100dvh - 360px)",
  overflow: "hidden",
};

const previewInnerMobileRunStyle: React.CSSProperties = {
  minWidth: "100%",
  width: "100%",
  minHeight: 0,
};

const previewGridMobileRunStyle: React.CSSProperties = {
  gap: 4,
};

const mobileRotateOverlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 6,
  display: "grid",
  placeItems: "center",
  background: "rgba(2,6,23,0.58)",
  pointerEvents: "none",
};

const mobileRotateCardStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 16,
  background: "rgba(15,23,42,0.92)",
  border: "1px solid rgba(96,165,250,0.25)",
  color: "#dbeafe",
  fontSize: 15,
  fontWeight: 900,
  textAlign: "center",
  boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
  maxWidth: 280,
};

function previewGlowStyle(accent: string): React.CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    background: `radial-gradient(circle at 20% 20%, ${accent}18, transparent 22%), radial-gradient(circle at 75% 30%, ${accent}12, transparent 24%), radial-gradient(circle at 50% 80%, ${accent}10, transparent 24%)`,
  };
}

const previewInnerStyle: React.CSSProperties = {
  position: "relative",
  minWidth: 1100,
  minHeight: 820,
};

const previewGridStyle: React.CSSProperties = {
  position: "relative",
  display: "grid",
  gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
  gap: 6,
};

const tileStyle: React.CSSProperties = {
  aspectRatio: "1 / 1",
  position: "relative",
  borderRadius: 8,
  display: "grid",
  placeItems: "center",
  overflow: "hidden",
};

const pickupDotStyle: React.CSSProperties = {
  borderRadius: 999,
};

const tokenStyle: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  position: "relative",
  zIndex: 2,
};

const boardLegendStyle: React.CSSProperties = {
  position: "relative",
  marginTop: 16,
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  fontSize: 12,
  opacity: 0.9,
};

const tunnelLeaderboardWrapStyle: React.CSSProperties = {
  marginTop: 26,
  display: "flex",
  flexDirection: "column",
  gap: 18,
};

const tunnelLeaderboardGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 18,
};

const tunnelLeaderboardGridMobileStyle: React.CSSProperties = {
  gridTemplateColumns: "1fr",
};

const leaderboardBaseCardStyle: React.CSSProperties = {
  borderRadius: 20,
  padding: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(9,12,22,0.92)",
  boxShadow: "0 18px 40px rgba(0,0,0,0.32)",
  overflow: "hidden",
};

const leaderboardCardBlueStyle: React.CSSProperties = {
  ...leaderboardBaseCardStyle,
  background: "linear-gradient(135deg, rgba(96,165,250,0.12), rgba(9,12,22,0.95))",
  boxShadow: "0 0 0 1px rgba(96,165,250,0.35), 0 0 32px rgba(96,165,250,0.22), 0 18px 40px rgba(0,0,0,0.45)",
  borderColor: "rgba(96,165,250,0.3)",
};

const leaderboardCardGoldStyle: React.CSSProperties = {
  ...leaderboardBaseCardStyle,
  background: "linear-gradient(135deg, rgba(250,204,21,0.10), rgba(9,12,22,0.95))",
  boxShadow: "0 0 0 1px rgba(250,204,21,0.35), 0 0 32px rgba(250,204,21,0.20), 0 18px 40px rgba(0,0,0,0.45)",
  borderColor: "rgba(250,204,21,0.3)",
};

const leaderboardCardRedStyle: React.CSSProperties = {
  ...leaderboardBaseCardStyle,
  background: "linear-gradient(135deg, rgba(244,63,94,0.10), rgba(9,12,22,0.95))",
  boxShadow: "0 0 0 1px rgba(244,63,94,0.35), 0 0 32px rgba(244,63,94,0.20), 0 18px 40px rgba(0,0,0,0.45)",
  borderColor: "rgba(244,63,94,0.3)",
};

const leaderboardCardHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginBottom: 14,
};

const leaderboardTitleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 900,
  letterSpacing: 0.5,
  textShadow: "0 0 20px currentColor",
};

const leaderboardSubtitleStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.72,
  marginTop: 2,
};

const leaderboardBadgeBlueStyle: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 800,
  background: "rgba(96,165,250,0.14)",
  border: "1px solid rgba(96,165,250,0.28)",
  color: "#93c5fd",
};

const leaderboardBadgeGoldStyle: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 800,
  background: "rgba(250,204,21,0.14)",
  border: "1px solid rgba(250,204,21,0.28)",
  color: "#fde68a",
};

const leaderboardBadgeRedStyle: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 800,
  background: "rgba(244,63,94,0.14)",
  border: "1px solid rgba(244,63,94,0.28)",
  color: "#fda4af",
};

const leaderboardScrollStyle: React.CSSProperties = {
  maxHeight: 220,
  overflowY: "auto",
  paddingRight: 4,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

function leaderboardRowStyle(rank: number, glow: string): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 12px",
    borderRadius: 14,
    background:
      rank === 1
        ? "rgba(255,255,255,0.08)"
        : rank === 2
        ? "rgba(255,255,255,0.06)"
        : rank === 3
        ? "rgba(255,255,255,0.05)"
        : "rgba(255,255,255,0.035)",
    border:
      rank === 1
        ? `1px solid ${glow}55`
        : "1px solid rgba(255,255,255,0.06)",
    boxShadow:
      rank === 1
        ? `0 0 18px ${glow}22`
        : "none",
  };
}

function leaderboardRankStyle(rank: number): React.CSSProperties {
  return {
    minWidth: 42,
    height: 42,
    borderRadius: 12,
    display: "grid",
    placeItems: "center",
    fontWeight: 900,
    fontSize: 14,
    background:
      rank === 1
        ? "rgba(250,204,21,0.16)"
        : rank === 2
        ? "rgba(148,163,184,0.18)"
        : rank === 3
        ? "rgba(251,146,60,0.16)"
        : "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
  };
}

const leaderboardNameStyle: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 14,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const leaderboardValueStyle: React.CSSProperties = {
  fontWeight: 900,
  fontSize: 15,
  opacity: 0.95,
};

const leaderboardEmptyStyle: React.CSSProperties = {
  padding: "18px 10px",
  borderRadius: 14,
  background: "rgba(255,255,255,0.035)",
  border: "1px solid rgba(255,255,255,0.06)",
  opacity: 0.8,
  textAlign: "center",
};

const personalStatsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 14,
};

const personalStatsGridMobileStyle: React.CSSProperties = {
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
};

function personalStatBoxStyle(accent: string): React.CSSProperties {
  return {
    borderRadius: 12,
    padding: 12,
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${accent}33`,
    boxShadow: `0 0 18px ${accent}12`,
  };
}

const personalStatLabelStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.72,
  marginBottom: 8,
};

const personalStatValueStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 900,
  lineHeight: 1.1,
};

const tunnelTopMetaRowStyle: React.CSSProperties = {
  marginTop: 18,
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  gap: 12,
  alignItems: "start",
};

const tunnelTopMetaRowMobileStyle: React.CSSProperties = {
  gridTemplateColumns: "1fr",
};
const tunnelFlavorQuoteStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 14,
  background: "linear-gradient(135deg, rgba(96,165,250,0.08), rgba(244,63,94,0.06))",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "#e5e7eb",
  fontSize: 13,
  lineHeight: 1.55,
  fontWeight: 700,
  minHeight: 42,
  display: "flex",
  alignItems: "center",
};

const tunnelRulesLinkStyle: React.CSSProperties = {
  minWidth: 240,
  padding: "12px 16px",
  borderRadius: 14,
  border: "1px solid rgba(96,165,250,0.22)",
  background: "rgba(9,12,22,0.92)",
  boxShadow: "0 0 0 1px rgba(96,165,250,0.10), 0 0 18px rgba(96,165,250,0.08)",
  color: "#dbeafe",
  fontSize: 14,
  fontWeight: 900,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  whiteSpace: "nowrap",
};

const tunnelRulesSectionStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 16,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
};

const tunnelRulesSectionTitleStyle: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 900,
  marginBottom: 10,
};

const tunnelRulesParagraphStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.7,
  opacity: 0.9,
};

const tunnelRulesListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  fontSize: 14,
  lineHeight: 1.8,
  opacity: 0.9,
};

const mobileBreakButtonStyle: React.CSSProperties = {
  width: 72,
  height: 72,
  borderRadius: 999,
  border: "1px solid rgba(250,204,21,0.18)",
  background: "rgba(250,204,21,0.10)",
  color: "#fde68a",
  fontSize: 12,
  fontWeight: 900,
  cursor: "pointer",
  boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
  backdropFilter: "blur(3px)",
  WebkitBackdropFilter: "blur(3px)",
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
  WebkitTapHighlightColor: "transparent",
  touchAction: "none",
  outline: "none",
};

const mobileRotatePromptWrapStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 300,
  display: "grid",
  placeItems: "center",
  background: "rgba(2,6,23,0.68)",
  padding: 24,
};

const mobileRotatePromptCardStyle: React.CSSProperties = {
  maxWidth: 320,
  padding: "16px 18px",
  borderRadius: 18,
  background: "rgba(15,23,42,0.96)",
  border: "1px solid rgba(96,165,250,0.26)",
  color: "#dbeafe",
  fontSize: 16,
  fontWeight: 900,
  lineHeight: 1.45,
  textAlign: "center",
  boxShadow: "0 16px 40px rgba(0,0,0,0.32)",
};
