import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePoints } from "../lib/usePoints";
import { loadProfile, getEffectivePlayerId, saveProfile } from "../lib/profile";
import BuyPointsModal from "./BuyPointsModal";
import SharedEconomyPanel from "./SharedEconomyPanel";

type Cell = { row: number; col: number };
type Facing = "up" | "down" | "left" | "right";
type BoardTheme = "colony" | "neon" | "mythic";
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

const themeMap: Record<
  BoardTheme,
  {
    name: string;
    bg: string;
    floor: string;
    wall: string;
    accent: string;
    crumb: string;
    sugar: string;
    crystal: string;
    antGlow: string;
    spiderGlow: string;
  }
> = {
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
};

function cellKey(cell: Cell) {
  return `${cell.row}:${cell.col}`;
}

function isOuterBorder(row: number, col: number) {
  return row === 0 || row === GRID_ROWS - 1 || col === 0 || col === GRID_COLS - 1;
}

const TUNNEL_LAYOUTS: string[][] = [
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
  ],
];

function baseWall(row: number, col: number, layoutIndex: number) {
  if (isOuterBorder(row, col)) return true;
  const layout = TUNNEL_LAYOUTS[layoutIndex] || TUNNEL_LAYOUTS[0];
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

export default function TunnelShell() {
  const initialProfile = loadProfile();
  const initialName = (initialProfile?.name || "guest").trim() || "guest";
  const initialEffectiveId = getEffectivePlayerId(initialProfile);

    const [playerName, setPlayerName] = useState(initialName);
  const [effectivePlayerId] = useState(initialEffectiveId);
  const [showBuyPoints, setShowBuyPoints] = useState(false);
  const [tunnelCfg, setTunnelCfg] = useState(DEFAULT_TUNNEL_CONFIG);

    const [boardTheme, setBoardTheme] = useState<BoardTheme>("colony");
  const [layoutIndex, setLayoutIndex] = useState(0);
const [isPlaying, setIsPlaying] = useState(false);
const [timeLeft, setTimeLeft] = useState(DEFAULT_TUNNEL_CONFIG.tunnelRunSeconds);
const [score, setScore] = useState(0);
const [runMessage, setRunMessage] = useState("");
const [didWinRun, setDidWinRun] = useState(false);
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

      setTopScoreRows(Array.isArray(j.topScore) ? j.topScore : []);
      setFastestClearRows(Array.isArray(j.fastestClear) ? j.fastestClear : []);
      setPersonalStats(j.personalStats || null);
    } catch {
      // ignore for now
    } finally {
      setLeaderboardLoading(false);
    }
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
        }
        return current.filter((c) => !(c.row === nextRow && c.col === nextCol));
      });

      setSugars((current) => {
        const found = current.some((c) => c.row === nextRow && c.col === nextCol);
        if (found) {
          setScore((s) => s + 5);
          triggerPickupBurst(nextRow, nextCol, "sugar");
        }
        return current.filter((c) => !(c.row === nextRow && c.col === nextCol));
      });

      setCrystals((current) => {
        const found = current.some((c) => c.row === nextRow && c.col === nextCol);
        if (found) {
          setScore((s) => s + 20);
          triggerPickupBurst(nextRow, nextCol, "crystal");
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

  function setupNewRun() {
    const nextLayoutIndex = Math.floor(Math.random() * TUNNEL_LAYOUTS.length);
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
      setIsPlaying(true);
      setRunMessage("");

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

            const crystalsCollected = Math.max(0, runCrystalTarget - crystals.length);
      await recordTunnelRun({
        score,
        fullClear: false,
        crystalsCollected,
      });
      await loadTunnelLeaderboard();

      if (score <= 0) {
        setRunMessage("Run complete. No points earned this time.");
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

            await recordTunnelRun({
        score,
        fullClear: true,
        crystalsCollected: runCrystalTarget,
      });
      await loadTunnelLeaderboard();

      if (score <= 0) {
        setRunMessage("Crystal sweep complete! No points earned this time.");
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

    window.setTimeout(() => {
      setHitFlash(false);
    }, 220);

    window.setTimeout(() => {
      setHitShake(false);
    }, 180);
  }, [playerPos, spiderPos, isPlaying]);

       useLayoutEffect(() => {
    if (isMobileView) return;

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
  }, [playerPos, isPlaying, isMobileView]);
  
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
  return (
    <>
            <main
        style={{
          maxWidth: 1600,
          margin: "0 auto",
          padding: isPlaying && isMobileView ? "10px 8px" : "32px 16px",
        }}
      >
        <header style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 28, fontWeight: 900, marginBottom: 8 }}>
            <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
              Rebel Ants Playground
            </Link>
          </div>

          <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/tunnel" style={tabActiveStyle}>
              Ant Tunnel
            </Link>
            <Link href="/hatch" style={tabStyle}>
              Queen&apos;s Egg Hatch
            </Link>
            <Link href="/expedition" style={tabStyle}>
              Expedition
            </Link>
            <Link href="/shuffle" style={tabStyle}>
              Shuffle
            </Link>
          </nav>
        </header>

              <div
          style={{
            ...cardStyle,
            ...(isPlaying && isMobileView ? mobileRunCardStyle : null),
          }}
        >
          {!(isPlaying && isMobileView) && (
            <>
              <div style={{ fontSize: 30, fontWeight: 900, marginBottom: 6 }}>
                Ant Tunnel
              </div>
              <p style={{ opacity: 0.88, marginBottom: 18 }}>
                Samurai Rebel Ants. Underground tunnels. Crumbs, sugar, crystals, danger, and breakable walls.
              </p>

              <SharedEconomyPanel
                playerId={effectivePlayerId}
                balance={balance}
                totalPlaysLeft={totalEarnRoom}
                dailyPlaysLeft={remainingDaily}
                bonusPlayBank={capBank}
                dailyCap={Number(dailyCap || 0)}
                currency={tunnelCfg.currency}
                dailyClaimAmount={tunnelCfg.dailyClaim}
                onOpenBuyPoints={() => setShowBuyPoints(true)}
                onRefresh={refresh}
              />
              <div
                style={{
                  ...tunnelTopMetaRowStyle,
                  ...(isMobileView ? tunnelTopMetaRowMobileStyle : null),
                }}
              >
                <label style={{ fontSize: 13, opacity: 0.9 }}>
                  Name:&nbsp;
                  <input
                    value={playerName}
                    onChange={(e) => {
                      const v = (e.target.value.slice(0, 18) || "guest").trim() || "guest";
                      setPlayerName(v);

                      const p = loadProfile();
                      const id = (p?.id || "guest").trim() || "guest";
                      saveProfile({ name: v, id });
                    }}
                    style={inputStyle}
                  />
                </label>

                <div style={tunnelFlavorQuoteStyle}>
                  Move with purpose. Break what stands in your way. In the dark, hesitation is defeat.
                </div>

                <Link href="/tunnel-rules" style={tunnelRulesLinkStyle}>
                  How to Play + Official Rules
                </Link>
              </div>
              <div style={themeSwitchWrapStyle}>
                <button
                  type="button"
                  onClick={() => setBoardTheme("colony")}
                  style={boardTheme === "colony" ? themeButtonActiveStyle(themeMap.colony.accent) : themeButtonStyle}
                >
                  Colony Tunnel
                </button>
                <button
                  type="button"
                  onClick={() => setBoardTheme("neon")}
                  style={boardTheme === "neon" ? themeButtonActiveStyle(themeMap.neon.accent) : themeButtonStyle}
                >
                  Neon Sci-Fi
                </button>
                <button
                  type="button"
                  onClick={() => setBoardTheme("mythic")}
                  style={boardTheme === "mythic" ? themeButtonActiveStyle(themeMap.mythic.accent) : themeButtonStyle}
                >
                  Dark Mythic
                </button>
              </div>
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

          <div style={gameBoardWrapStyle}>
            <div style={gameBoardStyle}>
              <div style={boardHeaderStyle}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 900 }}>{theme.name}</div>
                  <div style={{ fontSize: 13, opacity: 0.82 }}>
                                       Desktop: arrow keys move, Space breaks. Mobile: swipe to move, tap Break to smash walls.
                  </div>

                                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    {!isPlaying && (
                      <button
                        onClick={() => {
                          void startRun();
                        }}
                        style={startRunButtonStyle}
                      >
                        Start Run
                      </button>
                    )}

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

              <div style={{ padding: 18 }}>
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
    }}
  >
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
                    background: theme.bg,
                    overflow: isPlaying && isMobileView ? "hidden" : undefined,
                    touchAction: isPlaying && isMobileView ? "none" : undefined,
                  }}
                >
                                   <div style={previewGlowStyle(theme.accent)} />

                  {isPlaying && isMobileView && !isLandscape && (
                    <div style={mobileRotateOverlayStyle}>
                      <div style={mobileRotateCardStyle}>
                        Rotate your phone to landscape for a better game experience
                      </div>
                    </div>
                  )}

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
                                src="/ants/samurai.png"
                                alt="Samurai Ant"
                                style={{
                                  width: isMobileView ? "110%" : "125%",
                                  height: isMobileView ? "110%" : "125%",
                                  objectFit: "contain",
                                  transform: "translateY(3px)",
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
              <div className="mobileOnlyControls">
                <button
                  type="button"
                  style={mobileBreakButtonStyle}
                  onTouchStart={pressMobileBreak}
                  onMouseDown={pressMobileBreak}
                >
                  Break
                </button>
              </div>
            )}
          </div>

          <div style={tunnelLeaderboardWrapStyle}>
                       <div
              style={{
                ...tunnelLeaderboardGridStyle,
                ...(isMobileView ? tunnelLeaderboardGridMobileStyle : null),
              }}
            >
              <div style={leaderboardCardBlueStyle}>
                <div style={leaderboardCardHeaderStyle}>
                  <div>
                    <div style={leaderboardTitleStyle}>Top Score</div>
                    <div style={leaderboardSubtitleStyle}>All-Time Tunnel Leaders</div>
                  </div>
                  <div style={leaderboardBadgeBlueStyle}>Top 5</div>
                </div>

                <div style={leaderboardScrollStyle}>
                  {leaderboardLoading ? (
                    <div style={leaderboardEmptyStyle}>Loading...</div>
                  ) : topScoreRows.length === 0 ? (
                    <div style={leaderboardEmptyStyle}>No Tunnel scores yet.</div>
                  ) : (
                    topScoreRows.map((row) => (
                      <div
                        key={`score-${row.playerId}-${row.rank}`}
                        style={leaderboardRowStyle(row.rank, "#60a5fa")}
                      >
                        <div style={leaderboardRankStyle(row.rank)}>#{row.rank}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={leaderboardNameStyle}>{row.playerName || row.playerId}</div>
                        </div>
                        <div style={leaderboardValueStyle}>{Number(row.score || 0).toLocaleString()}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div style={leaderboardCardGoldStyle}>
                <div style={leaderboardCardHeaderStyle}>
                  <div>
                    <div style={leaderboardTitleStyle}>Fastest Clear</div>
                    <div style={leaderboardSubtitleStyle}>Full Crystal Sweep Only</div>
                  </div>
                  <div style={leaderboardBadgeGoldStyle}>Top 5</div>
                </div>

                <div style={leaderboardScrollStyle}>
                  {leaderboardLoading ? (
                    <div style={leaderboardEmptyStyle}>Loading...</div>
                  ) : fastestClearRows.length === 0 ? (
                    <div style={leaderboardEmptyStyle}>No full clears yet.</div>
                  ) : (
                    fastestClearRows.map((row) => (
                      <div
                        key={`fast-${row.playerId}-${row.rank}`}
                        style={leaderboardRowStyle(row.rank, "#facc15")}
                      >
                        <div style={leaderboardRankStyle(row.rank)}>#{row.rank}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={leaderboardNameStyle}>{row.playerName || row.playerId}</div>
                        </div>
                        <div style={leaderboardValueStyle}>{formatMs(row.clearTimeMs)}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div style={leaderboardCardRedStyle}>
              <div style={leaderboardCardHeaderStyle}>
                <div>
                  <div style={leaderboardTitleStyle}>Your Tunnel Stats</div>
                  <div style={leaderboardSubtitleStyle}>Personal Progress</div>
                </div>
                <div style={leaderboardBadgeRedStyle}>You</div>
              </div>

                           <div
                style={{
                  ...personalStatsGridStyle,
                  ...(isMobileView ? personalStatsGridMobileStyle : null),
                }}
              >
                <div style={personalStatBoxStyle("#60a5fa")}>
                  <div style={personalStatLabelStyle}>Best Score</div>
                  <div style={personalStatValueStyle}>
                    {Number(personalStats?.bestScore || 0).toLocaleString()}
                  </div>
                </div>

                <div style={personalStatBoxStyle("#facc15")}>
                  <div style={personalStatLabelStyle}>Best Clear Time</div>
                  <div style={personalStatValueStyle}>
                    {personalStats?.bestClearTimeMs ? formatMs(personalStats.bestClearTimeMs) : "--"}
                  </div>
                </div>

                <div style={personalStatBoxStyle("#22c55e")}>
                  <div style={personalStatLabelStyle}>Total Runs</div>
                  <div style={personalStatValueStyle}>
                    {Number(personalStats?.totalRuns || 0).toLocaleString()}
                  </div>
                </div>

                <div style={personalStatBoxStyle("#f43f5e")}>
                  <div style={personalStatLabelStyle}>Total Crystals</div>
                  <div style={personalStatValueStyle}>
                    {Number(personalStats?.totalCrystals || 0).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <BuyPointsModal
        open={showBuyPoints}
        onClose={() => setShowBuyPoints(false)}
        playerId={effectivePlayerId}
        onClaimed={async () => {
          await refresh();
        }}
      />

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
            right: max(10px, env(safe-area-inset-right));
            bottom: max(10px, env(safe-area-inset-bottom));
            z-index: 120;
            display: block;
            padding: 4px;
            border-radius: 999px;
            background: rgba(2, 6, 23, 0.06);
            backdrop-filter: blur(2px);
            -webkit-backdrop-filter: blur(2px);
            box-shadow: 0 3px 10px rgba(0,0,0,0.08);
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
  background:
    "radial-gradient(circle at top, rgba(96,165,250,0.09), rgba(15,23,42,0.95) 45%)",
  overflow: "hidden",
};

const boardHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  padding: 16,
  borderBottom: "1px solid rgba(255,255,255,0.08)",
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
  padding: 20,
  height: "78vh",
  minHeight: 760,
  maxHeight: 980,
  scrollBehavior: "smooth",
};

const boardPreviewMobileStyle: React.CSSProperties = {
  padding: 10,
  height: "62vh",
  minHeight: 420,
  maxHeight: 560,
};

const previewInnerMobileStyle: React.CSSProperties = {
  minWidth: 920,
  minHeight: 700,
};

const previewGridMobileStyle: React.CSSProperties = {
  gap: 6,
};

const boardPreviewMobileRunStyle: React.CSSProperties = {
  padding: 8,
  height: "calc(100dvh - 140px)",
  minHeight: "calc(100dvh - 140px)",
  maxHeight: "calc(100dvh - 140px)",
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
  minWidth: 1500,
  minHeight: 1100,
};

const previewGridStyle: React.CSSProperties = {
  position: "relative",
  display: "grid",
  gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
  gap: 10,
};

const tileStyle: React.CSSProperties = {
  aspectRatio: "1 / 1",
  position: "relative",
  borderRadius: 12,
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
  boxShadow: "0 0 0 1px rgba(96,165,250,0.18), 0 0 24px rgba(96,165,250,0.14), 0 18px 40px rgba(0,0,0,0.32)",
};

const leaderboardCardGoldStyle: React.CSSProperties = {
  ...leaderboardBaseCardStyle,
  boxShadow: "0 0 0 1px rgba(250,204,21,0.18), 0 0 24px rgba(250,204,21,0.12), 0 18px 40px rgba(0,0,0,0.32)",
};

const leaderboardCardRedStyle: React.CSSProperties = {
  ...leaderboardBaseCardStyle,
  boxShadow: "0 0 0 1px rgba(244,63,94,0.18), 0 0 24px rgba(244,63,94,0.12), 0 18px 40px rgba(0,0,0,0.32)",
};

const leaderboardCardHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginBottom: 14,
};

const leaderboardTitleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 900,
  letterSpacing: 0.2,
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
  maxHeight: 310,
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
    borderRadius: 16,
    padding: 16,
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
  fontSize: 24,
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
