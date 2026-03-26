import React, { useState } from "react";
import Link from "next/link";
import { usePoints } from "../lib/usePoints";
import { loadProfile, getEffectivePlayerId, saveProfile } from "../lib/profile";
import BuyPointsModal from "./BuyPointsModal";

export default function TunnelShell() {
  const [isPlaying, setIsPlaying] = useState(false);
const [timeLeft, setTimeLeft] = useState(30);
const [score, setScore] = useState(0);
const [playerPos, setPlayerPos] = useState({ row: 4, col: 5 });

  const initialProfile = loadProfile();
  const initialName = (initialProfile?.name || "guest").trim() || "guest";
  const initialEffectiveId = getEffectivePlayerId(initialProfile);

  const [playerName, setPlayerName] = useState(initialName);
  const [effectivePlayerId] = useState(initialEffectiveId);
  const [showBuyPoints, setShowBuyPoints] = useState(false);

  const {
    balance,
    capBank,
    remainingDaily,
    totalEarnRoom,
    refresh,
  } = usePoints(effectivePlayerId);

  React.useEffect(() => {
  if (!isPlaying) return;

  const interval = setInterval(() => {
    setTimeLeft((t) => {
      if (t <= 1) {
        clearInterval(interval);
        setIsPlaying(false);

        // reward logic goes here later
        console.log("Run ended. Score:", score);

        return 0;
      }
      return t - 1;
    });
  }, 1000);

  return () => clearInterval(interval);
}, [isPlaying, score]);

React.useEffect(() => {
  if (!isPlaying) return;

  const onKeyDown = (e: KeyboardEvent) => {
    setPlayerPos((prev) => {
      let nextRow = prev.row;
      let nextCol = prev.col;

      if (e.key === "ArrowUp") nextRow -= 1;
      if (e.key === "ArrowDown") nextRow += 1;
      if (e.key === "ArrowLeft") nextCol -= 1;
      if (e.key === "ArrowRight") nextCol += 1;

      nextRow = Math.max(0, Math.min(7, nextRow));
      nextCol = Math.max(0, Math.min(11, nextCol));

      if (nextRow === prev.row && nextCol === prev.col) return prev;

      return { row: nextRow, col: nextCol };
    });
  };

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, [isPlaying]);

const tunnelCost = 200;

  return (
    <>
      <main className="max-w-6xl mx-auto px-4 py-8">
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
            Samurai Rebel Ants. Underground tunnels. Crumbs, sugar, crystals, and danger.
          </p>

          <div style={statsWrapStyle}>
            <span>
              Balance: <b>{balance}</b>
            </span>
            <span>
              Cost per run: <b>{tunnelCost}</b>
            </span>
            <span style={{ fontWeight: 800, color: "#60a5fa" }}>
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

          <div style={gameBoardWrapStyle}>
            <div style={gameBoardStyle}>
              <div style={boardHeaderStyle}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>Colony Tunnel Board</div>
                  <div style={{ fontSize: 13, opacity: 0.82 }}>
                    V1 shell is now live. Next step is the real movement board.
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    {!isPlaying && (
                      <button
                       onClick={() => {
  if (totalEarnRoom <= 0) {
    alert("No plays left");
    return;
  }
  setIsPlaying(true);
  setTimeLeft(30);
  setScore(0);
  setPlayerPos({ row: 4, col: 5 });
}}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 10,
                          fontWeight: 800,
                          background: "rgba(34,197,94,0.2)",
                          border: "1px solid rgba(34,197,94,0.4)",
                          color: "#86efac",
                          cursor: "pointer",
                        }}
                      >
                        Start Run
                      </button>
                    )}
                  </div>
                </div>

                <div style={boardBadgeStyle}>
                  Cost: {tunnelCost}
                </div>
              </div>

              <div style={boardPreviewStyle}>
                <div style={previewGlowStyle} />

                <div style={previewGridStyle}>
                  {Array.from({ length: 96 }, (_, i) => (
                    <div
                      key={i}
                      style={{
                        borderRadius: 6,
                        background:
                          i % 7 === 0
                            ? "rgba(96, 165, 250, 0.14)"
                            : i % 11 === 0
                            ? "rgba(250, 204, 21, 0.18)"
                            : "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.04)",
                      }}
                    />
                  ))}
                </div>

                <div
  style={{
    ...samuraiAntTokenStyle,
    left: `${playerPos.col * (100 / 12) + 100 / 24}%`,
    top: `${playerPos.row * (420 / 8) + 420 / 16 + 18}px`,
  }}
>
  🐜
</div>

                <div style={{ marginTop: 12, fontSize: 14, fontWeight: 700 }}>
                  {isPlaying && (
                    <>
                      ⏱ Time: {timeLeft}s &nbsp;&nbsp; | &nbsp;&nbsp; 🎯 Score: {score}
                    </>
                  )}
                </div>

                <div style={boardLegendStyle}>
                  <span>Crumb = 1</span>
                  <span>Sugar = 5</span>
                  <span>Crystal = 20</span>
                  <span>Spider hit = -3 sec</span>
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
  alignItems: "center",
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

const boardPreviewStyle: React.CSSProperties = {
  position: "relative",
  minHeight: 520,
  padding: 18,
  overflow: "hidden",
  background:
    "linear-gradient(180deg, rgba(16,24,39,0.15), rgba(0,0,0,0.22)), linear-gradient(135deg, #2d1f14, #1b130d)",
};

const previewGlowStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  background:
    "radial-gradient(circle at 20% 20%, rgba(250,204,21,0.08), transparent 22%), radial-gradient(circle at 75% 30%, rgba(96,165,250,0.08), transparent 24%), radial-gradient(circle at 50% 80%, rgba(251,191,36,0.06), transparent 24%)",
};

const previewGridStyle: React.CSSProperties = {
  position: "relative",
  display: "grid",
  gridTemplateColumns: "repeat(12, 1fr)",
  gridTemplateRows: "repeat(8, 1fr)",
  gap: 8,
  height: 420,
};

const samuraiAntTokenStyle: React.CSSProperties = {
  position: "absolute",
  left: "48%",
  top: "47%",
  transform: "translate(-50%, -50%)",
  width: 58,
  height: 58,
  borderRadius: 14,
  display: "grid",
  placeItems: "center",
  fontSize: 30,
  background: "rgba(15,23,42,0.92)",
  border: "1px solid rgba(255,255,255,0.18)",
  boxShadow: "0 0 24px rgba(96,165,250,0.25)",
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
