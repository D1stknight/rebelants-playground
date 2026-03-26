import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePoints } from "../lib/usePoints";
import { loadProfile, getEffectivePlayerId, saveProfile } from "../lib/profile";
import BuyPointsModal from "./BuyPointsModal";

type Cell = { row: number; col: number };
type Facing = "up" | "down" | "left" | "right";
type BoardTheme = "colony" | "neon" | "mythic";

const GRID_ROWS = 14;
const GRID_COLS = 22;
const RUN_SECONDS = 40;
const TUNNEL_COST = 200;
const WALL_BREAKS_PER_RUN = 5;

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

function baseWall(row: number, col: number) {
  if (isOuterBorder(row, col)) return true;

  if ((row === 2 || row === 11) && ((col >= 3 && col <= 7) || (col >= 14 && col <= 18))) return true;
  if ((row === 4 || row === 9) && ((col >= 2 && col <= 5) || (col >= 8 && col <= 12) || (col >= 16 && col <= 19))) return true;
  if (row === 6 && ((col >= 4 && col <= 9) || (col >= 13 && col <= 17))) return true;
  if (row === 7 && ((col >= 4 && col <= 6) || (col >= 15 && col <= 17))) return true;

  if ((col === 6 || col === 15) && ((row >= 2 && row <= 4) || (row >= 9 && row <= 11))) return true;
  if (col === 10 && row >= 5 && row <= 8) return true;

  return false;
}

function isBreakableBaseWall(row: number, col: number) {
  if (isOuterBorder(row, col)) return false;
  return baseWall(row, col);
}

function isWall(row: number, col: number, brokenWallSet: Set<string>) {
  if (!baseWall(row, col)) return false;
  return !brokenWallSet.has(cellKey({ row, col }));
}

function getOpenCells(brokenWallSet: Set<string>) {
  const open: Cell[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      if (!isWall(row, col, brokenWallSet)) {
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

export default function TunnelShell() {
  const initialProfile = loadProfile();
  const initialName = (initialProfile?.name || "guest").trim() || "guest";
  const initialEffectiveId = getEffectivePlayerId(initialProfile);

  const [playerName, setPlayerName] = useState(initialName);
  const [effectivePlayerId] = useState(initialEffectiveId);
  const [showBuyPoints, setShowBuyPoints] = useState(false);

  const [boardTheme, setBoardTheme] = useState<BoardTheme>("colony");
  const [isPlaying, setIsPlaying] = useState(false);
  const [timeLeft, setTimeLeft] = useState(RUN_SECONDS);
  const [score, setScore] = useState(0);
  const [runMessage, setRunMessage] = useState("");
  const [playerPos, setPlayerPos] = useState<Cell>(START_CELL);
   const [crumbs, setCrumbs] = useState<Cell[]>([]);
  const [sugars, setSugars] = useState<Cell[]>([]);
  const [crystals, setCrystals] = useState<Cell[]>([]);
  const [spiderPos, setSpiderPos] = useState<Cell>({ row: 1, col: 10 });
  const [wallBreaksLeft, setWallBreaksLeft] = useState(WALL_BREAKS_PER_RUN);
  const [brokenWalls, setBrokenWalls] = useState<string[]>([]);
  const [facing, setFacing] = useState<Facing>("right");

  const lastHitRef = useRef(0);
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const playerTileRef = useRef<HTMLDivElement | null>(null);

  const {
    balance,
    capBank,
    remainingDaily,
    totalEarnRoom,
    refresh,
  } = usePoints(effectivePlayerId);

  const theme = themeMap[boardTheme];
  const brokenWallSet = useMemo(() => new Set(brokenWalls), [brokenWalls]);

  function setupNewRun() {
    const nextBrokenWalls: string[] = [];
    const nextBrokenWallSet = new Set(nextBrokenWalls);
    const openCells = getOpenCells(nextBrokenWallSet);

       const excluded = new Set<string>([
      cellKey(START_CELL),
      cellKey({ row: 1, col: 10 }),
    ]);

    const crumbCells = pickRandomCells(openCells, 95, excluded);
    crumbCells.forEach((c) => excluded.add(cellKey(c)));

    const sugarCells = pickRandomCells(openCells, 18, excluded);
    sugarCells.forEach((c) => excluded.add(cellKey(c)));

    const crystalCells = pickRandomCells(openCells, 4, excluded);

    setBrokenWalls(nextBrokenWalls);
    setPlayerPos(START_CELL);
    setCrumbs(crumbCells);
    setSugars(sugarCells);
    setCrystals(crystalCells);
       setSpiderPos({ row: 1, col: 10 });
    setScore(0);
    setTimeLeft(RUN_SECONDS);
    setWallBreaksLeft(WALL_BREAKS_PER_RUN);
    setFacing("right");
    setRunMessage("");
    lastHitRef.current = 0;
  }

  function startRun() {
    if (isPlaying) return;

    if (Number(totalEarnRoom || 0) < TUNNEL_COST) {
      setRunMessage("No plays left today. Buy points to add bonus plays.");
      return;
    }

    if (balance < TUNNEL_COST) {
      setRunMessage("Not enough points to start a Tunnel run.");
      return;
    }

    setupNewRun();
    setIsPlaying(true);
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

    setIsPlaying(false);
    setRunMessage(`Run complete. Final score: ${score}`);
  }, [timeLeft, isPlaying, score]);

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setSpiderPos((current) => {
        const directions = [
          { row: -1, col: 0 },
          { row: 1, col: 0 },
          { row: 0, col: -1 },
          { row: 0, col: 1 },
        ];

        const dx = playerPos.col - current.col;
        const dy = playerPos.row - current.row;

        const preferred: { row: number; col: number }[] = [];

        if (Math.abs(dx) > Math.abs(dy)) {
          preferred.push({ row: 0, col: dx > 0 ? 1 : -1 });
        } else {
          preferred.push({ row: dy > 0 ? 1 : -1, col: 0 });
        }

        const moves = [...preferred, ...directions];

        for (const move of moves) {
          const nextRow = current.row + move.row;
          const nextCol = current.col + move.col;

          if (
            nextRow >= 0 &&
            nextRow < GRID_ROWS &&
            nextCol >= 0 &&
            nextCol < GRID_COLS &&
            !isWall(nextRow, nextCol, brokenWallSet)
          ) {
            return { row: nextRow, col: nextCol };
          }
        }

        return current;
      });
    }, 300);

    return () => clearInterval(interval);
  }, [isPlaying, playerPos, brokenWallSet]);
  useEffect(() => {
    if (!isPlaying) return;

    const now = Date.now();
    if (playerPos.row !== spiderPos.row || playerPos.col !== spiderPos.col) return;
    if (now - lastHitRef.current < 900) return;

    lastHitRef.current = now;
    setTimeLeft((t) => Math.max(0, t - 3));
    setRunMessage("Spider hit! -3 seconds");
  }, [playerPos, spiderPos, isPlaying]);

  useLayoutEffect(() => {
    const wrap = boardScrollRef.current;
    const playerEl = playerTileRef.current;

    if (!wrap || !playerEl) return;

    const wrapRect = wrap.getBoundingClientRect();
    const playerRect = playerEl.getBoundingClientRect();

    const playerCenterX =
      playerRect.left - wrapRect.left + wrap.scrollLeft + playerRect.width / 2;
    const playerCenterY =
      playerRect.top - wrapRect.top + wrap.scrollTop + playerRect.height / 2;

    const targetLeft = Math.max(0, playerCenterX - wrap.clientWidth / 2);
    const targetTop = Math.max(0, playerCenterY - wrap.clientHeight / 2);

    wrap.scrollTo({
      left: targetLeft,
      top: targetTop,
      behavior: "smooth",
    });
  }, [playerPos, isPlaying]);
  
  useEffect(() => {
    if (!isPlaying) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const validMove = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      const isBreak = e.code === "Space";

      if (!validMove.includes(e.key) && !isBreak) return;

      e.preventDefault();

      if (isBreak) {
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

        if (!isBreakableBaseWall(target.row, target.col)) {
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
        setRunMessage("Wall broken ✅");
        return;
      }

      setPlayerPos((prev) => {
        let nextRow = prev.row;
        let nextCol = prev.col;
        let nextFacing: Facing = facing;

        if (e.key === "ArrowUp") {
          nextRow -= 1;
          nextFacing = "up";
        }
        if (e.key === "ArrowDown") {
          nextRow += 1;
          nextFacing = "down";
        }
        if (e.key === "ArrowLeft") {
          nextCol -= 1;
          nextFacing = "left";
        }
        if (e.key === "ArrowRight") {
          nextCol += 1;
          nextFacing = "right";
        }

        setFacing(nextFacing);

        nextRow = Math.max(0, Math.min(GRID_ROWS - 1, nextRow));
        nextCol = Math.max(0, Math.min(GRID_COLS - 1, nextCol));

        if (isWall(nextRow, nextCol, brokenWallSet)) return prev;
        if (nextRow === prev.row && nextCol === prev.col) return prev;

        setCrumbs((current) => {
          const found = current.some((c) => c.row === nextRow && c.col === nextCol);
          if (found) setScore((s) => s + 1);
          return current.filter((c) => !(c.row === nextRow && c.col === nextCol));
        });

        setSugars((current) => {
          const found = current.some((c) => c.row === nextRow && c.col === nextCol);
          if (found) setScore((s) => s + 5);
          return current.filter((c) => !(c.row === nextRow && c.col === nextCol));
        });

        setCrystals((current) => {
          const found = current.some((c) => c.row === nextRow && c.col === nextCol);
          if (found) setScore((s) => s + 20);
          return current.filter((c) => !(c.row === nextRow && c.col === nextCol));
        });

        return { row: nextRow, col: nextCol };
      });
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPlaying, facing, playerPos, wallBreaksLeft, brokenWallSet]);

  return (
    <>
      <main
        style={{
          maxWidth: 1600,
          margin: "0 auto",
          padding: "32px 16px",
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

        <div style={cardStyle}>
          <div style={{ fontSize: 30, fontWeight: 900, marginBottom: 6 }}>
            Ant Tunnel
          </div>
          <p style={{ opacity: 0.88, marginBottom: 18 }}>
            Samurai Rebel Ants. Underground tunnels. Crumbs, sugar, crystals, danger, and breakable walls.
          </p>

          <div style={statsWrapStyle}>
            <span>
              Balance: <b>{balance}</b>
            </span>
            <span>
              Cost per run: <b>{TUNNEL_COST}</b>
            </span>
            <span style={{ fontWeight: 800, color: theme.accent }}>
              Total plays left: <b>{Number(totalEarnRoom || 0).toLocaleString()}</b>
            </span>
            <span>
              Daily plays left: <b>{Number(remainingDaily || 0).toLocaleString()}</b>
            </span>
            <span>
              Bonus play bank: <b>{Number(capBank || 0).toLocaleString()}</b>
            </span>
          </div>

          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
            Daily plays reset every 24 hours. Bonus plays are included with point purchases and never expire.
          </div>

          <div
            style={{
              marginTop: 18,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
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

            <button
              type="button"
              onClick={() => setShowBuyPoints(true)}
              style={buttonStyle}
            >
              Buy Points / Connect Ape Wallet
            </button>

            <Link href="/shuffle" style={secondaryButtonStyle}>
              Back to Shuffle
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

          <div style={gameBoardWrapStyle}>
            <div style={gameBoardStyle}>
              <div style={boardHeaderStyle}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 900 }}>{theme.name}</div>
                  <div style={{ fontSize: 13, opacity: 0.82 }}>
                    Arrow keys move. Space breaks a wall in front of you.
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    {!isPlaying && (
                      <button onClick={startRun} style={startRunButtonStyle}>
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
                      🧱 Wall Breaks: <b>{wallBreaksLeft}</b>
                    </div>
                  </div>
                </div>

                <div style={boardBadgeStyle}>
                  Cost: {TUNNEL_COST}
                </div>
              </div>

              <div style={{ padding: 18 }}>
                {runMessage ? <div style={runMessageStyle}>{runMessage}</div> : null}

                               <div
                  ref={boardScrollRef}
                  style={{ ...boardPreviewStyle, background: theme.bg }}
                >
                  <div style={previewGlowStyle(theme.accent)} />

                  <div style={previewInnerStyle}>
                    <div style={previewGridStyle}>
                    {Array.from({ length: GRID_ROWS * GRID_COLS }, (_, i) => {
                      const row = Math.floor(i / GRID_COLS);
                      const col = i % GRID_COLS;

                      const wall = isWall(row, col, brokenWallSet);
                      const hasCrumb = crumbs.some((c) => c.row === row && c.col === col);
                      const hasSugar = sugars.some((c) => c.row === row && c.col === col);
                      const hasCrystal = crystals.some((c) => c.row === row && c.col === col);
                      const isPlayer = playerPos.row === row && playerPos.col === col;
                      const isSpider = spiderPos?.row === row && spiderPos?.col === col;

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
                                ...pickupDotStyle,
                                width: 10,
                                height: 10,
                                background: theme.crumb,
                                boxShadow: `0 0 10px ${theme.crumb}`,
                              }}
                            />
                          )}

                          {!wall && hasSugar && (
                            <div
                              className="sugarPulse"
                              style={{
                                ...pickupDotStyle,
                                width: 14,
                                height: 14,
                                background: theme.sugar,
                                boxShadow: `0 0 14px ${theme.sugar}`,
                              }}
                            />
                          )}

                          {!wall && hasCrystal && (
                            <div
                              className="crystalPulse"
                              style={{
                                width: 18,
                                height: 18,
                                transform: "rotate(45deg)",
                                borderRadius: 4,
                                background: theme.crystal,
                                boxShadow: `0 0 18px ${theme.crystal}`,
                              }}
                            />
                          )}

                          {!wall && isSpider && (
                            <div
                              className="spiderBob"
                              style={{
                                ...tokenStyle,
                                width: 34,
                                height: 34,
                                borderRadius: 12,
                                background: "rgba(127,29,29,0.92)",
                                border: "1px solid rgba(248,113,113,0.28)",
                                boxShadow: theme.spiderGlow,
                                fontSize: 18,
                              }}
                            >
                              🕷️
                            </div>
                          )}

                          {!wall && isPlayer && (
                            <div
                              className="antFloat"
                              style={{
                                ...tokenStyle,
                                width: 38,
                                height: 38,
                                borderRadius: 14,
                                background: "rgba(15,23,42,0.96)",
                                border: "1px solid rgba(255,255,255,0.18)",
                                boxShadow: theme.antGlow,
                                fontSize: 20,
                              }}
                            >
                              🐜
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                                   <div style={boardLegendStyle}>
                    <span>Crumb = 1</span>
                    <span>Sugar = 5</span>
                    <span>Crystal = 20</span>
                    <span>Spider hit = -3 sec</span>
                    <span>Wall breaks = 5</span>
                  </div>
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
