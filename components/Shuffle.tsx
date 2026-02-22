// components/Shuffle.tsx
import React, { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { shuffleConfig } from "../lib/shuffleConfig";

// ✅ points + leaderboard (single source of truth)
import { pointsConfig } from "../lib/pointsConfig";
import { usePoints } from "../lib/usePoints";
import { loadProfile, saveProfile } from "../lib/profile";
import { addWin } from "../lib/winsStore";
import LeaderboardPanel from "./LeaderboardPanel";

// lazy-load queen so 3D never blocks SSR
const Queen3D = dynamic(() => import("./Queen3D"), { ssr: false }) as React.ComponentType<{
  active?: boolean;
  scale?: number;
  y?: number;
}>;

type Phase = "idle" | "shuffling" | "pick" | "revealed";
type Rarity = "none" | "common" | "rare" | "ultra";

const EGG_COUNT = shuffleConfig.eggCount; // ✅ 5 (from lib/shuffleConfig.ts)
const SHUFFLE_MS = 3200;
const SWAP_EVERY_MS = 280;

// lane positions across the scene (percent). Works for 3, 5, etc.
const LANES = Array.from({ length: EGG_COUNT }, (_, i) => {
  // spread evenly from 12% to 88% so edges have padding
  const min = 12;
  const max = 88;
  if (EGG_COUNT === 1) return 50;
  return min + (i * (max - min)) / (EGG_COUNT - 1);
});

/* ---------------- utils ---------------- */
function rollRarity(): Rarity {
  const r = Math.random();
  if (r < 0.05) return "ultra";
  if (r < 0.18) return "rare";
  if (r < 0.55) return "common";
  return "none";
}

function shuffledN(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* -------- progress: ant line -------- */
function AntIcon() {
  return (
    <img
      src="/ui/ant-progress.png"
      alt="ant"
      className="ant-img"
      style={{ width: 22, height: 22 }}
      loading="eager"
      decoding="async"
    />
  );
}

function AntProgress({ progress }: { progress: number }) {
  const ants = useMemo(() => Array.from({ length: 8 }, (_, i) => i), []);

  return (
    <div
      className="ant-progress"
      role="progressbar"
      aria-valuenow={progress}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="track" />

      {ants.map((i) => (
        <div
          key={i}
          className="ant"
          style={{
            left: `${Math.max(0, Math.min(100, progress) - i * 3)}%`,
          }}
        >
          <AntIcon />
        </div>
      ))}

      <style jsx>{`
        :global(.ant-img) {
          width: 20px;
          height: 20px;
          display: block;
          object-fit: contain;
          transform: scale(1.6);
          transform-origin: center;
          filter: drop-shadow(0 0 4px rgba(0, 255, 170, 0.35));
        }

        .ant-progress {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          bottom: 14px;
          width: 92%;
          height: 42px;
          pointer-events: none;
          z-index: 26;
        }

        .track {
          position: absolute;
          left: 0;
          right: 0;
          top: 65%;
          height: 7px;
          transform: translateY(-50%);
          border-radius: 999px;
          background: linear-gradient(
                90deg,
                rgba(255, 255, 255, 0.08) 0 2px,
                transparent 2px
              )
              repeat-x,
            linear-gradient(90deg, #22324a, #1a2a3f);
          background-size: 14px 7px, auto;
          box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.35),
            0 0 0 1px rgba(255, 255, 255, 0.06);
          opacity: 0.9;
        }

        .ant {
          position: absolute;
          top: 70%;
          width: 22px;
          height: 22px;
          transform: translate(-50%, -50%);
          animation: antBob 0.58s ease-in-out infinite;
          pointer-events: none;
          overflow: visible;
        }

        .ant:nth-child(2n) {
          animation-duration: 0.66s;
        }

        @keyframes antBob {
          0%,
          100% {
            transform: translate(-50%, -50%);
          }
          50% {
            transform: translate(-50%, -53%);
          }
        }
      `}</style>
    </div>
  );
}

/* -------- prize modal (bright sparkles) -------- */
function PrizeModal({ rarity, onClose }: { rarity: Rarity; onClose: () => void }) {
  const title =
    rarity === "ultra"
      ? "ULTRA CRATE!"
      : rarity === "rare"
      ? "Rare Crate!"
      : rarity === "common"
      ? "Crate Unlocked"
      : "No crate this time";

  const sparks = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => ({
        left: `${8 + (i * 4.1) % 84}%`,
        top: `${10 + (i * 7.3) % 62}%`,
        size: 10 + ((i * 3) % 14),
        delay: (i * 0.18) % 3.2,
      })),
    []
  );

  return (
    <div className="prize-modal" role="dialog" aria-modal="true">
      <div className={`prize-card pm-${rarity}`}>
        {rarity !== "none" && (
          <div className="sparkle-layer" aria-hidden="true">
            {sparks.map((s, i) => (
              <span
                key={i}
                className={`pm-sparkle ${rarity}`}
                style={{
                  left: s.left,
                  top: s.top,
                  width: s.size,
                  height: s.size,
                  animationDelay: `${s.delay}s`,
                }}
              />
            ))}
          </div>
        )}

        <div className="prize-title">{title}</div>

        {rarity !== "none" ? (
          <>
            <div className="prize-aura" data-rarity={rarity} />
            <img className="prize-art" src={`/crates/${rarity}.png`} alt={`${rarity} crate`} />
            <div className="prize-sub">Tap continue to play again.</div>
          </>
        ) : (
          <div className="prize-sub" style={{ marginBottom: 12 }}>
            Bummer! Try another egg.
          </div>
        )}

        <button className="btn" onClick={onClose}>
          Continue
        </button>
      </div>

      <style jsx>{`
        .prize-modal {
          position: fixed;
          inset: 0;
          display: grid;
          place-items: center;
          background: rgba(0, 0, 0, 0.5);
          z-index: 1000;
        }
        .prize-card {
          position: relative;
          min-width: 320px;
          padding: 20px;
          border-radius: 12px;
          text-align: center;
          background: rgba(15, 23, 42, 0.95);
          border: 1px solid rgba(148, 163, 184, 0.25);
          box-shadow: 0 24px 40px rgba(0, 0, 0, 0.55);
          overflow: visible;
        }
        .prize-title {
          font-size: 18px;
          font-weight: 800;
          margin: 10px 0;
        }
        .prize-sub {
          font-size: 14px;
          opacity: 0.85;
          margin-bottom: 12px;
        }
        .prize-art {
          display: block;
          width: 240px;
          max-width: 80vw;
          height: auto;
          margin: 0 auto 12px;
          position: relative;
          z-index: 1;
        }
        .sparkle-layer {
          position: absolute;
          inset: -8% -10%;
          pointer-events: none;
          z-index: 0;
        }
        .pm-sparkle {
          position: absolute;
          border-radius: 50%;
          background: radial-gradient(
            circle,
            rgba(255, 255, 255, 0.95) 0%,
            rgba(255, 255, 255, 0) 65%
          );
          filter: blur(0.3px) drop-shadow(0 0 12px rgba(255, 255, 255, 0.65));
          opacity: 0;
          animation: pmSpark 2.6s ease-in-out infinite;
        }
        .pm-sparkle.common {
          filter: blur(0.3px) drop-shadow(0 0 14px rgba(147, 197, 253, 0.85));
        }
        .pm-sparkle.rare {
          filter: blur(0.3px) drop-shadow(0 0 14px rgba(59, 130, 246, 0.95));
        }
        .pm-sparkle.ultra {
          filter: blur(0.3px) drop-shadow(0 0 16px rgba(244, 63, 94, 1));
        }
        @keyframes pmSpark {
          0% {
            transform: scale(0.4);
            opacity: 0;
          }
          20% {
            opacity: 1;
          }
          55% {
            transform: scale(1.1);
            opacity: 0.9;
          }
          85% {
            transform: scale(0.7);
            opacity: 0.7;
          }
          100% {
            transform: scale(0.3);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

/* ---------------- component ---------------- */
export default function Shuffle() {
  const { balance, spend, earn, claimDaily } = usePoints();

  const [playerName, setPlayerName] = useState("guest");

  React.useEffect(() => {
    const p = loadProfile();
    setPlayerName(p.name || "guest");
  }, []);

  const [phase, setPhase] = useState<Phase>('idle');
const [showHowPointsWork, setShowHowPointsWork] = useState(false);
  const [order, setOrder] = useState<number[]>(() => Array.from({ length: EGG_COUNT }, (_, i) => i));
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [rarity, setRarity] = useState<Rarity>("none");
  const [showPrize, setShowPrize] = useState(false);

  const runShuffle = () => {
    if (busy) return;

    const cost = pointsConfig.shuffleCost;
    if (balance < cost) return;

    spend(cost);

    setBusy(true);
    setPhase("shuffling");
    setProgress(0);
    setShowPrize(false);

    let swapTimer: NodeJS.Timeout | null = null;
    swapTimer = setInterval(() => setOrder(shuffledN(EGG_COUNT)), SWAP_EVERY_MS);

    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / SHUFFLE_MS);
      setProgress(Math.floor(p * 100));
      if (p < 1) requestAnimationFrame(tick);
      else {
        if (swapTimer) clearInterval(swapTimer);
        setProgress(100);
        setPhase("pick");
        setBusy(false);
      }
    };

    requestAnimationFrame(tick);
  };

  const onPick = () => {
    if (phase !== "pick" || busy) return;

    setBusy(true);

    setTimeout(() => {
      const r = rollRarity();

      const reward =
        r === "ultra"
          ? pointsConfig.rewards.ultra
          : r === "rare"
          ? pointsConfig.rewards.rare
          : r === "common"
          ? pointsConfig.rewards.common
          : pointsConfig.rewards.none;

      if (reward > 0) {
        earn(reward);

        const prof = loadProfile();
        addWin({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          ts: Date.now(),
          game: "shuffle",
          playerId: prof.id,
          playerName: playerName || prof.name || "guest",
          rarity: r,
          pointsAwarded: reward,
        });
      }

      setRarity(r);
      setPhase("revealed");
      setShowPrize(true);
      setBusy(false);
    }, 350);
  };

  const resetAfterPrize = () => {
    setShowPrize(false);
    setRarity("none");
    setProgress(0);
    setOrder(Array.from({ length: EGG_COUNT }, (_, i) => i));
    setPhase("idle");
  };

  return (
    <>
      {/* full-screen ant colony BG */}
      <div className="ant-colony-bg" aria-hidden="true" />

      {/* HEADER */}
      <header className="page-head" role="banner">
        <div className="site-title">
          <Link href="/">Rebel Ants Playground</Link>
        </div>
        <nav className="tabs" aria-label="Main">
          <Link href="/tunnel" className="tab">
            Ant Tunnel
          </Link>
          <Link href="/hatch" className="tab">
            Queen&apos;s Egg Hatch
          </Link>
          <Link href="/expedition" className="tab">
            Expedition
          </Link>
          <Link href="/shuffle" className="tab tab-active">
            Shuffle
          </Link>
        </nav>
      </header>

      {/* Game card */}
      <div className="ant-card ra-shuffle2">
        <div className="title">Queen&apos;s Egg Shuffle</div>
        <p className="subtitle">
          {EGG_COUNT} eggs. We shuffle. You pick one for a prize.
        </p>

        <div className="shuffle-scene ant-scene" style={{ position: "relative" }}>
          {/* in-scene dojo BG */}
          <div className="scene-bg" aria-hidden="true" />
          <div className="strip" />

          {/* Queen 3D */}
          <Queen3D active={phase === "shuffling"} scale={shuffleConfig.queenScale} y={-0.1} />

          <div className="rail rail-top" />
          <div className="rail rail-bottom" />

          <AntProgress progress={progress} />

          {Array.from({ length: EGG_COUNT }, (_, i) => (
            <button
              key={i}
              className={`egg-card ${phase === "pick" ? "can-pick" : ""}`}
              style={{ left: `${LANES[order[i]]}%`, top: "58%" }}
              onClick={onPick}
              disabled={phase !== "pick" || busy}
              aria-label="Pick egg"
            >
              <div className={`egg-body ${phase === "pick" ? "wobble-on-pick" : ""}`} />
              <div className="egg-shadow" />
              <div className="egg-speckle" />
            </button>
          ))}
        </div>

        {/* Shuffle CTA + Balance (THIS DIV MUST CLOSE before the Name section) */}
       <div className="shuffle-cta">
  {(() => {
    const cost = pointsConfig.shuffleCost;
    const needMore = Math.max(0, cost - balance);

    return (
      <>
        <button
          className="btn"
          onClick={runShuffle}
          disabled={busy || phase === "shuffling" || needMore > 0}
          title={needMore > 0 ? "Not enough points" : ""}
        >
          {phase === "shuffling"
            ? "Shuffling…"
            : `Shuffle (-${cost} ${pointsConfig.currency})`}
        </button>

        <div style={{ marginLeft: 12, fontSize: 13, opacity: 0.9 }}>
          Balance: <b>{balance}</b> {pointsConfig.currency}
          {needMore > 0 && (
            <>
              {" "}
              <span style={{ opacity: 0.9 }}>
                Need {needMore} more {pointsConfig.currency}.
              </span>
            </>
          )}
        </div>
      </>
    );
  })()}
</div>

    <div>
      Need {Math.max(0, pointsConfig.shuffleCost - balance)} more {pointsConfig.currency}.
    </div>
  </div>

  <div style={{ marginTop: 6 }}>
    <button
      type="button"
      onClick={() => setShowHowPointsWork((v) => !v)}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
        textDecoration: "underline",
        color: "inherit",
        opacity: 0.9,
        fontSize: 13,
      }}
    >
      How points work
    </button>
  </div>
</div>
{showHowPointsWork && (
  <div
    style={{
      marginTop: 10,
      padding: 12,
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,.14)",
      background: "rgba(15,23,42,.45)",
      backdropFilter: "blur(6px)",
      fontSize: 13,
      lineHeight: 1.35,
      opacity: 0.95,
      maxWidth: 520,
    }}
  >
    <div style={{ fontWeight: 800, marginBottom: 6 }}>How points work</div>

    <div style={{ display: "grid", gap: 6 }}>
      <div>
        <b>Shuffle costs</b> {pointsConfig.shuffleCost} {pointsConfig.currency}.
      </div>

      <div>
        <b>Rewards:</b>{" "}
        Common +{pointsConfig.rewards.common}, Rare +{pointsConfig.rewards.rare}, Ultra +{pointsConfig.rewards.ultra}.
      </div>

      <div>
        <b>Daily claim:</b> +{pointsConfig.dailyClaim} {pointsConfig.currency} (1x per day).
      </div>

      <div>
        <b>Daily earn cap:</b> {pointsConfig.dailyEarnCap} {pointsConfig.currency}.
      </div>

      <div style={{ opacity: 0.85 }}>
        Tip: earn points from crates, then spend them to keep playing. In Step B we’ll persist this on the server + global leaderboard.
      </div>
    </div>

    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        className="btn"
        onClick={() => setShowHowPointsWork(false)}
        style={{ padding: "8px 12px", fontSize: 13 }}
      >
        Close
      </button>
    </div>
  </div>
)}

  {balance < pointsConfig.shuffleCost && (
    <div style={{ fontSize: 13, opacity: 0.85 }}>
      Need <b>{pointsConfig.shuffleCost - balance}</b> more {pointsConfig.currency}.
    </div>
  )}
</div>

        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>
  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
    <span>Cost: <b>{pointsConfig.shuffleCost}</b> {pointsConfig.currency}</span>
    <span>Common: <b>+{pointsConfig.rewards.common}</b></span>
    <span>Rare: <b>+{pointsConfig.rewards.rare}</b></span>
    <span>Ultra: <b>+{pointsConfig.rewards.ultra}</b></span>
    <span>Daily cap: <b>{pointsConfig.dailyEarnCap}</b></span>
  </div>
</div>
        
        {/* Name + Daily Claim */}
       <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
  <label style={{ fontSize: 13, opacity: 0.9 }}>
    Name:&nbsp;
    <input
      value={playerName}
      onChange={(e) => {
        const v = e.target.value.slice(0, 18);
        setPlayerName(v);
        saveProfile({ name: v });
      }}
      style={{
        padding: "6px 10px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,.18)",
        background: "rgba(15,23,42,.55)",
        color: "inherit",
      }}
    />
  </label>

  <button
    className="btn"
    onClick={() => claimDaily(pointsConfig.dailyClaim)}
    style={{ padding: "8px 12px", fontSize: 13 }}
  >
    Claim Daily +{pointsConfig.dailyClaim} {pointsConfig.currency}
  </button>

  {/* DEV ONLY: test credits so we can click Shuffle without changing economy */}
  {process.env.NODE_ENV !== "production" && (
    <button
      className="btn"
      onClick={() => earn(5000)}
      style={{ padding: "8px 12px", fontSize: 13, opacity: 0.9 }}
      title="Dev only"
    >
      Dev Grant +5000 {pointsConfig.currency}
    </button>
  )}
</div>
        {/* Official Rules link */}
        <div className="rules-row">
          <a className="rules-link" href="/rules">
            Official Rules
          </a>
        </div>

       <div
  style={{
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(15,23,42,.35)",
    backdropFilter: "blur(6px)",
  }}
>
  <LeaderboardPanel />
</div>

        {showPrize && <PrizeModal rarity={rarity} onClose={resetAfterPrize} />}
      </div>

      {/* Background + header styles (scoped) */}
      <style jsx>{`
        .ant-colony-bg {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 0;
          background-image: linear-gradient(
              140deg,
              rgba(11, 27, 49, 0.18),
              rgba(7, 13, 26, 0.55)
            ),
            url("${shuffleConfig.pageBg}");
          background-position: center, center;
          background-size: cover, cover;
          background-repeat: no-repeat, no-repeat;
          filter: saturate(1.05);
        }

        .page-head {
          position: relative;
          z-index: 50;
          max-width: 980px;
          margin: 24px auto 14px;
          padding: 4px 2px;
        }
        .site-title {
          font-size: 22px;
          font-weight: 800;
          margin-bottom: 8px;
        }
        .site-title :global(a) {
          color: inherit;
          text-decoration: none;
        }
        .tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .tab {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 13px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.18);
          backdrop-filter: blur(4px);
          transition: transform 0.06s ease, background 0.2s ease;
        }
        .tab:hover {
          transform: translateY(-1px);
          background: rgba(255, 255, 255, 0.12);
        }
        .tab-active {
          background: rgba(255, 255, 255, 0.16);
        }

        .scene-bg {
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          border-radius: 12px;
          background-image: linear-gradient(180deg, rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0.18)),
            url("${shuffleConfig.cardBg}");
          background-position: center, center;
          background-size: cover, cover;
          background-repeat: no-repeat, no-repeat;
          box-shadow: inset 0 12px 30px rgba(0, 0, 0, 0.35);
        }

        .rules-row {
          margin-top: 10px;
        }
        .rules-link {
          display: inline-block;
          font-size: 13px;
          text-decoration: underline;
          opacity: 0.85;
          transition: opacity 0.15s ease;
        }
        .rules-link:hover {
          opacity: 1;
        }
      `}</style>
    </>
  );
}
