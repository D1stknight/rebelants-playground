// components/Shuffle.tsx
import React, { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { shuffleConfig } from "../lib/shuffleConfig";

// ✅ points + leaderboard (single source of truth)
import { pointsConfig as defaultPointsConfig } from "../lib/pointsConfig";
import { usePoints } from "../lib/usePoints";
import { loadProfile, saveProfile, getEffectivePlayerId } from "../lib/profile";
import { addWin } from "../lib/winsStore";
import LeaderboardPanel from "./LeaderboardPanel";
import BuyPointsModal from "./BuyPointsModal";

// lazy-load queen so 3D never blocks SSR
const Queen3D = dynamic(() => import("./Queen3D"), { ssr: false }) as React.ComponentType<{
  active?: boolean;
  scale?: number;
  y?: number;
}>;

type Phase = "idle" | "shuffling" | "pick" | "revealed";
type WinPrize = {
  type: "points" | "nft" | "ape" | "merch" | "none";
  label: string;
  amount?: number; // for points/ape
  meta?: Record<string, any>;
};
type Rarity = "none" | "common" | "rare" | "ultra";

type Prize =
  | { type: "none"; label: string }
  | { type: "points"; label: string; points: number }
  | { type: "merch"; label: string; meta?: any }
  | { type: "nft"; label: string; meta?: any }
  | { type: "ape"; label: string; meta?: any };

// Pick a weighted prize from Admin-configured prizePools
function pickWeightedPrize(pool: any[]): any | null {
  if (!Array.isArray(pool) || pool.length === 0) return null;

  const items = pool
    .map((p) => ({ ...p, weight: Number(p?.weight ?? 0) }))
    .filter((p) => Number.isFinite(p.weight) && p.weight > 0);

  if (!items.length) return null;

  const total = items.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;

  for (const p of items) {
    r -= p.weight;
    if (r <= 0) return p;
  }

  return items[items.length - 1];
}

function normalizePrize(rarity: Rarity, pointsConfig: any): Prize {
  // 1) Try prizePools first (Admin-editable)
  const pool = pointsConfig?.prizePools?.[rarity];
  const picked = pickWeightedPrize(pool);

  if (picked) {
    const t = String(picked?.type || "").toUpperCase();
    const label = String(picked?.label || "");

    if (t === "POINTS") {
      const pts = Number(picked?.points ?? picked?.amount ?? 0);
      return {
        type: "points",
        points: Number.isFinite(pts) ? pts : 0,
        label: label || `${pts} ${pointsConfig?.currency || "REBEL"}`,
      };
    }
    if (t === "NONE") return { type: "none", label: label || "Nothing this time" };
    if (t === "MERCH") return { type: "merch", label: label || "Merch Prize", meta: picked };
    if (t === "NFT") return { type: "nft", label: label || "NFT Prize", meta: picked };
    if (t === "APE") return { type: "ape", label: label || "APE Prize", meta: picked };
  }

  // 2) Fallback to old rewards map (points only)
  const reward =
    rarity === "ultra"
      ? pointsConfig?.rewards?.ultra
      : rarity === "rare"
      ? pointsConfig?.rewards?.rare
      : rarity === "common"
      ? pointsConfig?.rewards?.common
      : 0;

  const pts = Number(reward || 0);

  if (!Number.isFinite(pts) || pts <= 0) {
    return { type: "none", label: "Nothing this time" };
  }

  return {
    type: "points",
    points: pts,
    label: `${pts} ${pointsConfig?.currency || "REBEL"}`,
  };
}

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
      
    </div>
  );
}

/* -------- prize modal (bright sparkles) -------- */
function PrizeModal({
  rarity,
  prize,
  onClose,
}: {
  rarity: Rarity;
  prize: Prize | null;
  onClose: () => void;
}) {
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

      {prize?.label ? (
        <div className="prize-sub" style={{ marginTop: 6 }}>
          <b>{prize.label}</b>
        </div>
      ) : null}

      {rarity !== "none" ? (
        <>
          <div className="prize-aura" data-rarity={rarity} />
          <img className="prize-art" src={`/crates/${rarity}.png`} alt={`${rarity} crate`} />

          <div className="prize-sub" style={{ marginBottom: 8 }}>
            You won:{" "}
            <b>
{prize?.type === "points" ? `+${prize.points}` : prize?.label || "—"}
            </b>
          </div>

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

    <style>{`
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
  const [{ name: initialName, id: initialId, effectiveId: initialEffectiveId }] = useState(() => {
    const p = loadProfile();

    const name = (p?.name || "guest").trim() || "guest";
    let id = (p?.id || "").trim();

    if (!id) {
      const suffix = Math.random().toString(36).slice(2, 7);
      id = `guest-${suffix}`;
      saveProfile({ name, id });
    }

    // ✅ NEW: Discord > Wallet > Guest (uses your profile.ts helper)
    const effectiveId = getEffectivePlayerId({ ...p, id, name } as any);

    return { name, id, effectiveId };
  });

  const [playerName, setPlayerName] = useState(initialName);

  // ✅ Keep showing guest id in UI (for now)
  const [playerId, setPlayerId] = useState(initialId);

  // ✅ NEW: this is what points + wins should use going forward
  const [effectivePlayerId, setEffectivePlayerId] = useState(initialEffectiveId);

  // ✅ If profile identity changes (wallet connect / discord connect), refresh effective id
 React.useEffect(() => {
  const updateIdentity = () => {
    const p = loadProfile();
    const nextId = getEffectivePlayerId(p);
    setEffectivePlayerId(nextId);
    console.log("🔁 Identity updated:", nextId);
  };

  // initial sync
  updateIdentity();

  // listen for wallet / discord changes
  window.addEventListener("ra:identity-changed", updateIdentity);

  return () => {
    window.removeEventListener("ra:identity-changed", updateIdentity);
  };
}, []);

  // ✅ LIVE economy config (starts with defaults, then loads from /api/config)
  const [pointsConfig, setPointsConfig] = useState(defaultPointsConfig);

  // ✅ Pull latest config override from Redis
  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const r = await fetch("/api/config", { cache: "no-store" });
        const j = await r.json().catch(() => null);

        // expected: { ok: true, pointsConfig: {...} }
        if (!cancelled && r.ok && j?.pointsConfig) {
          setPointsConfig((prev) => ({ ...prev, ...j.pointsConfig }));
          console.log("LIVE POINTS CONFIG =", j.pointsConfig);
        } else {
          console.log("LIVE CONFIG NOT LOADED =", r.status, j);
        }
      } catch (e) {
        console.log("LIVE CONFIG ERROR =", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

const prof = loadProfile();
const computedEffectivePlayerId = getEffectivePlayerId(prof);

const { balance, spend, earn, claimDaily, devGrant, refresh } =
  usePoints(effectivePlayerId);

// ✅ Run once guard (prevents React crash loops / duplicate linking)
const didDiscordLinkRef = React.useRef(false);

React.useEffect(() => {
  if (didDiscordLinkRef.current) return;
  didDiscordLinkRef.current = true;

  let cancelled = false;

  (async () => {
    try {
      const sr = await fetch("/api/auth/discord/session", { cache: "no-store" });
      const sj = await sr.json().catch(() => null);

      if (!sr.ok || !sj?.ok || !sj?.discordUserId) return;

      const prof = loadProfile();
      const fromId = getEffectivePlayerId(prof); // current id (wallet or guest)
      const toId = `discord:${sj.discordUserId}`;

      // if already primary, nothing to do
      if (String(prof.primaryId || "") === toId) return;

      const lr = await fetch("/api/identity/link-discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromId }),
      });

      const lj = await lr.json().catch(() => null);
      if (!lr.ok || !lj?.ok) {
        console.warn("Discord link failed:", lr.status, lj);
        return;
      }

      // ✅ lock identity to Discord (permanent)
      saveProfile({
        discordUserId: sj.discordUserId,
        discordName: sj.discordName,
        primaryId: toId,
        name: sj.discordName || prof.name,
      });

      if (!cancelled) {
        // force refresh so UI pulls balance under new discord id
        await refresh();
      }
    } catch (e) {
      console.warn("Discord session check error:", e);
    }
  })();

  return () => {
    cancelled = true;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
  
console.log("PLAYER ID (guest) =", playerId, "| effective =", effectivePlayerId);

  const cost = pointsConfig.shuffleCost;
  const needMore = Math.max(0, cost - balance);

const [phase, setPhase] = useState<Phase>("idle");
const [showHowPointsWork, setShowHowPointsWork] = useState(false);
const [order, setOrder] = useState<number[]>(() => Array.from({ length: EGG_COUNT }, (_, i) => i));
const [progress, setProgress] = useState(0);
const [busy, setBusy] = useState(false);
const [rarity, setRarity] = useState<Rarity>("none");
const [prize, setPrize] = useState<Prize | null>(null);
const [showPrize, setShowPrize] = useState(false);
const [showBuyPoints, setShowBuyPoints] = useState(false);

// ✅ DRIP migrate UI
const [showDripMigrate, setShowDripMigrate] = useState(false);
const [dripBalance, setDripBalance] = useState<number | null>(null);
const [dripAmount, setDripAmount] = useState<number>(0);
const [dripBusy, setDripBusy] = useState(false);
const [dripStatus, setDripStatus] = useState("");

// ==============================
// ✅ ADD DAILY CLAIM BLOCK HERE
// ==============================

const [dailyClaimed, setDailyClaimed] = useState(false);
const [claimStatus, setClaimStatus] = useState("");
const [claimBusy, setClaimBusy] = useState(false);

async function refreshClaimStatus(pid: string) {
  try {
    const r = await fetch(
      `/api/points/claim?playerId=${encodeURIComponent(pid)}`,
      { cache: "no-store" }
    );
    const j = await r.json().catch(() => null);
    if (r.ok && j?.ok) setDailyClaimed(!!j.claimed);
  } catch {}
}

React.useEffect(() => {
  if (!effectivePlayerId) return;
  refreshClaimStatus(effectivePlayerId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [effectivePlayerId]);

async function claimDailyNow() {
  if (!effectivePlayerId) return;
  if (claimBusy) return;

  setClaimBusy(true);
  setClaimStatus("");

  try {
    const r = await fetch("/api/points/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: effectivePlayerId,
        amount: pointsConfig.dailyClaim,
      }),
    });

    const j = await r.json().catch(() => null);

    if (!r.ok || !j?.ok) {
      setClaimStatus(j?.error || "Claim failed.");
      return;
    }

    if (j?.alreadyClaimed) {
      setClaimStatus("Already claimed today ✅");
    } else {
      setClaimStatus(
        `Claimed +${j?.added || pointsConfig.dailyClaim} ${pointsConfig.currency} ✅`
      );
    }

    setDailyClaimed(true);
    await refresh();
  } catch (e: any) {
    setClaimStatus(e?.message || "Claim error");
  } finally {
    setClaimBusy(false);
  }
}
// ✅ NEW: show what the player actually won
const [winText, setWinText] = useState<string>("");
const runShuffle = async () => {
  if (busy) return;

  if (balance < cost) return;

    await spend(cost, "shuffle");

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

setTimeout(async () => {
        const r = rollRarity();

// ✅ Pick the actual prize (Admin prizePools first, fallback to rewards)
let pz = normalizePrize(r, pointsConfig);

// ✅ Enforce Ultra always awards at least pointsConfig.ultraMinReward (points only)
const ultraMin = Number((pointsConfig as any).ultraMinReward ?? 0);
if (
  r === "ultra" &&
  (pz.type === "none" || (pz.type === "points" && (!Number.isFinite(pz.points) || pz.points <= 0)))
) {
  const min = Number.isFinite(ultraMin) && ultraMin > 0 ? ultraMin : 50;
  pz = { type: "points", points: min, label: `${min} ${pointsConfig.currency || "REBEL"}` };
}

// ✅ Award points if prize is points
if (pz.type === "points" && pz.points > 0) {
  const earnRes: any = await earn(pz.points);

  if (earnRes?.ok === false) {
    console.warn("EARN failed:", earnRes);
  }

  const applied = Number(earnRes?.added ?? earnRes?.applied ?? pz.points);

  // If daily cap limited the reward
  if (Number.isFinite(applied) && applied < pz.points) {
    pz = {
      ...pz,
      label: `Daily cap reached — prize rolled, but only ${applied} ${pointsConfig.currency} could be credited today.`,
    };
  }

  await refresh();
}

// ✅ Save what the user won so the modal can show it
setPrize(pz);

// For wins tracking, store pointsAwarded only when it’s points
const pointsAwarded = pz.type === "points" ? pz.points : 0;

    // ✅ Determine player identity ONCE (so pid/pname always exist)
const prof = loadProfile();
const pid = (prof?.id || playerId || "guest").trim() || "guest";
const pname = (playerName || prof?.name || "guest").trim() || "guest";

// local (keep for now)
addWin({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  ts: Date.now(),
  game: "shuffle",
  playerId: pid,
  playerName: pname,
  rarity: r,
  pointsAwarded,
});

// server (source of truth for leaderboards)
await fetch("/api/wins/add", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    game: "shuffle",
    playerId: pid,
    playerName: pname,
    rarity: r,
    pointsAwarded,
  }),
}).catch(() => {});

setRarity(r);
setPhase("revealed");
setShowPrize(true);
setBusy(false);
    }, 350);
  };

  const resetAfterPrize = () => {
  setShowPrize(false);
  setRarity("none");
setWinText(""); // optional (can remove later)
setPrize(null); // ✅ clear actual prize object
  setProgress(0);
  setOrder(Array.from({ length: EGG_COUNT }, (_, i) => i));
  setPhase("idle");
};

async function openDripModal() {
  setDripStatus("");
  setDripBusy(true);
  setDripBalance(null);

  try {
    const r = await fetch("/api/drip/balance", { cache: "no-store" });
    const j = await r.json().catch(() => null);

    if (!r.ok || !j?.ok) {
      setDripStatus(j?.error || "Could not load DRIP balance.");
      setShowDripMigrate(true);
      return;
    }

    setDripBalance(Number(j.balance || 0));
    setDripAmount(0);
    setShowDripMigrate(true);
  } catch (e: any) {
    setDripStatus(e?.message || "DRIP balance error");
    setShowDripMigrate(true);
  } finally {
    setDripBusy(false);
  }
}

async function migrateDripNow() {
  const amt = Math.floor(Number(dripAmount || 0));
  if (!amt || amt <= 0) {
    setDripStatus("Enter an amount greater than 0.");
    return;
  }

  setDripBusy(true);
  setDripStatus("Migrating… (deducting from DRIP + crediting game)");

  try {
    const idem = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const r = await fetch("/api/drip/migrate", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-idempotency-key": idem,
  },
  body: JSON.stringify({
    amount: amt,
    playerId: effectivePlayerId,
    idempotencyKey: idem, // backup (optional)
  }),
});

    const j = await r.json().catch(() => null);

    if (!r.ok || !j?.ok) {
      setDripStatus(j?.error || "Migrate failed.");
      // refresh balance display if server returned it
      if (typeof j?.dripBalance === "number") setDripBalance(j.dripBalance);
      return;
    }

    setDripStatus(`✅ Migrated ${amt} points into the game.`);
    await refresh();

    // refresh DRIP balance after migration
    const br = await fetch("/api/drip/balance", { cache: "no-store" });
    const bj = await br.json().catch(() => null);
    if (br.ok && bj?.ok) setDripBalance(Number(bj.balance || 0));
  } catch (e: any) {
    setDripStatus(e?.message || "Migrate error");
  } finally {
    setDripBusy(false);
  }
}

return (  
    <>
      {/* full-screen ant colony BG */}
     <div
  className="ant-colony-bg"
  aria-hidden="true"
  style={{
    backgroundImage: `linear-gradient(
        140deg,
        rgba(11, 27, 49, 0.18),
        rgba(7, 13, 26, 0.55)
      ),
      url("${shuffleConfig.pageBg}")`,
  }}
/>

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
         <div
  className="scene-bg"
  aria-hidden="true"
  style={{
    backgroundImage: `linear-gradient(180deg, rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0.18)),
      url("${shuffleConfig.cardBg}")`,
  }}
/>
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

      {/* Shuffle button + balance row */}
<div className="shuffle-cta" style={{ position: "relative", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
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

 <button
  className="btn"
  type="button"
  onClick={() => setShowBuyPoints(true)}
  style={{ padding: "10px 12px", fontSize: 13, opacity: 0.95 }}
  title="Connect Ape wallet and buy points with APE"
>
  Buy Points / Connect Ape Wallet
</button>

  <button
  className="btn"
  type="button"
  onClick={() => {
    window.location.href = "/api/auth/discord/login";
  }}
  style={{ padding: "10px 12px", fontSize: 13, opacity: 0.95 }}
>
  Connect Discord
</button>

  <button
  className="btn"
  type="button"
  onClick={() => {
    window.location.href = "/api/auth/discord/logout";
  }}
  style={{ padding: "10px 12px", fontSize: 13, opacity: 0.95 }}
>
  Disconnect Discord
</button>  
  
  <div style={{ marginLeft: 12, fontSize: 13, opacity: 0.9, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
    <span>
      Balance: <b>{balance}</b> {pointsConfig.currency}
    </span>

    <button
      type="button"
      onClick={() => setShowHowPointsWork((v) => !v)}
      style={{
        border: "none",
        background: "transparent",
        color: "inherit",
        textDecoration: "underline",
        cursor: "pointer",
        padding: 0,
        fontSize: 12,
        opacity: 0.9,
      }}
    >
      How points work
    </button>

    {needMore > 0 && (
      <span style={{ opacity: 0.9 }}>
        Need {needMore} more {pointsConfig.currency}.
      </span>
    )}
  </div>

  {showHowPointsWork && (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: "calc(100% + 10px)",
        width: "min(520px, 92vw)",
        padding: 12,
        borderRadius: 12,
        background: "rgba(15,23,42,.92)",
        border: "1px solid rgba(255,255,255,.18)",
        boxShadow: "0 18px 40px rgba(0,0,0,.45)",
        zIndex: 80,
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 6 }}>How points work</div>
    <div style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.4 }}>
  • Shuffle costs <b>{pointsConfig.shuffleCost}</b> {pointsConfig.currency}.<br />
  • Daily claim is <b>once per day</b>: <b>+{pointsConfig.dailyClaim}</b> {pointsConfig.currency}.<br />
  • Gameplay earnings have a daily cap: <b>{pointsConfig.dailyEarnCap}</b>/day.<br />
  • Buy Points lets you connect an Ape wallet and purchase points with <b>APE</b> (1 APE = 100 pts).<br />
  • “Migrate from Discord (DRIP)” moves points into the game and <b>deducts them from DRIP</b> to prevent double-dipping.<br />
</div>
      <button
        type="button"
        className="btn"
        onClick={() => setShowHowPointsWork(false)}
        style={{ marginTop: 10, padding: "8px 12px", fontSize: 13 }}
      >
        Close
      </button>
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
        
     {/* Name + Claim + DRIP (aligned row) */}
<div
  style={{
    marginTop: 10,
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

        // Keep the existing stored id — never rewrite it from the name
        const p = loadProfile();
        const id = (p?.id || playerId || "guest").trim() || "guest";
        saveProfile({ name: v, id });
      }}
      style={{
        padding: "6px 10px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,.18)",
        background: "rgba(15,23,42,.55)",
        color: "inherit",
      }}
    />
    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}>
      Identity: <b>{effectivePlayerId}</b>
    </div>
  </label>

  <button
    className="btn"
    type="button"
    onClick={claimDailyNow}
    disabled={claimBusy || dailyClaimed}
    style={{ padding: "8px 12px", fontSize: 13 }}
    title={dailyClaimed ? "Already claimed today" : "Claim daily points"}
  >
    {dailyClaimed
      ? "Claimed Today ✅"
      : `Claim Daily +${pointsConfig.dailyClaim} ${pointsConfig.currency}`}
  </button>

  <button
    className="btn"
    type="button"
    onClick={async () => {
      await openDripModal();
    }}
    disabled={dripBusy}
    style={{ padding: "8px 12px", fontSize: 13 }}
    title="Move points from Discord (DRIP) into the game (and deduct them from DRIP so no double-dip)."
  >
    {dripBusy ? "Loading DRIP…" : "Migrate from Discord (DRIP)"}
  </button>

  {typeof dripBalance === "number" && (
    <div style={{ fontSize: 12, opacity: 0.9, display: "grid", alignItems: "center" }}>
      DRIP: <b>{dripBalance}</b>
    </div>
  )}

  {process.env.NODE_ENV !== "production" && (
    <button
      className="btn"
      type="button"
      onClick={async () => {
        await devGrant(5000);
        await refresh();
        alert("Dev grant applied ✅");
      }}
      style={{ padding: "8px 12px", fontSize: 13, opacity: 0.9 }}
      title="Dev only (ignores daily cap)"
    >
      Dev Grant +5000 {pointsConfig.currency}
    </button>
  )}

  {claimStatus && (
    <div style={{ fontSize: 12, opacity: 0.9 }}>
      {claimStatus}
    </div>
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

     {showPrize && <PrizeModal rarity={rarity} prize={prize} onClose={resetAfterPrize} />}
        
<BuyPointsModal
  open={showBuyPoints}
  onClose={() => setShowBuyPoints(false)}
  playerId={effectivePlayerId} // ✅ IMPORTANT: credit the same id the UI is showing
  onClaimed={async () => {
    await refresh();
  }}
/>

{showDripMigrate && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      zIndex: 2500,
      background: "rgba(0,0,0,.55)",
      display: "grid",
      placeItems: "center",
      padding: 16,
    }}
    role="dialog"
    aria-modal="true"
  >
    <div
      style={{
        width: "min(520px, 95vw)",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,.18)",
        background: "rgba(15,23,42,.96)",
        boxShadow: "0 28px 60px rgba(0,0,0,.55)",
        padding: 16,
        color: "white",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Migrate DRIP Points → Game</div>
        <button className="btn" onClick={() => setShowDripMigrate(false)} style={{ padding: "8px 12px" }}>
          Close
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9, lineHeight: 1.4 }}>
        This will <b>deduct</b> points from DRIP (Discord) and <b>credit</b> the same amount into the game.
        <br />
        No double-dipping.
      </div>

      <div style={{ marginTop: 12, fontSize: 13, opacity: 0.95 }}>
        DRIP Balance: <b>{typeof dripBalance === "number" ? dripBalance : "—"}</b>
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        <label style={{ fontSize: 12, opacity: 0.9 }}>Amount to migrate</label>
        <input
  value={dripAmount === 0 ? "" : String(dripAmount)}
  onChange={(e) => {
    const raw = String(e.target.value || "").replace(/^0+/, "");
    setDripAmount(Number(raw || 0));
  }}
  type="number"
  min={0}
  step={1}
  style={{
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,.18)",
    background: "rgba(15, 23, 42, 0.7)",
    color: "white",
    outline: "none",
    fontWeight: 800,
  }}
/>

        <button
          className="btn"
          type="button"
          onClick={migrateDripNow}
          disabled={dripBusy}
          style={{ padding: "12px 12px", textAlign: "left" }}
        >
          <div style={{ fontWeight: 900 }}>{dripBusy ? "Working…" : "Migrate Now"}</div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>
            Deduct from DRIP → Credit to <b>{effectivePlayerId}</b>
          </div>
        </button>
      </div>

      {dripStatus && (
        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.9, whiteSpace: "pre-wrap" }}>{dripStatus}</div>
      )}

    <style>{`
  .btn {
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(15, 23, 42, 0.7);
    color: white;
    font-weight: 800;
    cursor: pointer;
  }
  .btn:hover {
    background: rgba(15, 23, 42, 0.9);
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`}</style>
    </div>
  </div>
)}
      </div>

      {/* Background + header styles (scoped) */}
      <style>{`
      .ant-colony-bg {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
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
