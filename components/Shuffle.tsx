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
  const currency = pointsConfig?.currency || "REBEL";

  // ✅ Default points for C (safe fallback)
  const defaultPts =
    rarity === "ultra" ? 300 :
    rarity === "rare" ? 100 :
    rarity === "common" ? 50 : 0;

  // Helper: make a points prize
  const pointsPrize = (pts: number, label?: string): Prize => ({
    type: "points",
    points: pts,
    label: label || `${pts} ${currency}`,
  });

  // ✅ Rule C enforcement:
  // Common = points only (ignore prizePools)
  if (rarity === "common") {
    const pts = Number(pointsConfig?.rewards?.common ?? defaultPts);
    return Number.isFinite(pts) && pts > 0 ? pointsPrize(pts) : { type: "none", label: "Nothing this time" };
  }

  // Rare = points only (bigger) AND very occasionally merch
  if (rarity === "rare") {
    // optional: 1% chance to try merch from prizePools.rare (only merch entries)
    const merchChance = Number(pointsConfig?.rareMerchChance ?? 0.01); // default 1%
    const roll = Math.random();

    if (roll < merchChance) {
      const pool = (pointsConfig?.prizePools?.rare || []) as any[];
      const merchOnly = pool.filter((p) => String(p?.type || "").toUpperCase() === "MERCH");
      const picked = pickWeightedPrize(merchOnly);

      if (picked) {
        return { type: "merch", label: String(picked?.label || "Merch Prize"), meta: picked };
      }
      // if no merch available, fall back to points
    }

    const pts = Number(pointsConfig?.rewards?.rare ?? defaultPts);
    return Number.isFinite(pts) && pts > 0 ? pointsPrize(pts) : { type: "none", label: "Nothing this time" };
  }

 // Ultra = try NFT first; if none available -> points fallback higher than rare
if (rarity === "ultra") {
  const pool = (pointsConfig?.prizePools?.ultra || []) as any[];
  const nftOnly = pool.filter((p) => String(p?.type || "").toUpperCase() === "NFT");
  const picked = pickWeightedPrize(nftOnly);

  if (picked) {
    return { type: "nft", label: String(picked?.label || "NFT Prize"), meta: picked };
  }

  // fallback points (higher than rare) + enforce ultraMinReward
  const ptsCfg = Number(pointsConfig?.rewards?.ultra ?? defaultPts);
  const min = Number(pointsConfig?.ultraMinReward ?? defaultPts);

  const pts = Math.max(
    Number.isFinite(ptsCfg) ? ptsCfg : defaultPts,
    Number.isFinite(min) ? min : defaultPts
  );

  return pointsPrize(pts);
}

  // none
  return { type: "none", label: "Nothing this time" };
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
  if (r < 0.01) return "ultra";   // 1%
  if (r < 0.15) return "rare";    // 15%
  if (r < 0.55) return "common";  // 37%
  return "none";                  // 45%
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
  needShipping,
  shippingForm,
  setShippingForm,
  shipBusy,
  shipMsg,
  onSubmitShipping,
}: {
  rarity: Rarity;
  prize: Prize | null;
  onClose: () => void;

  // ✅ merch shipping flow
  needShipping: boolean;
  shippingForm: any;
  setShippingForm: (v: any) => void;
  shipBusy: boolean;
  shipMsg: string;
  onSubmitShipping: () => Promise<void>;
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

         {needShipping ? (
  <div style={{ marginTop: 10, textAlign: "left" }}>
    <div className="prize-sub" style={{ marginBottom: 10 }}>
      ✅ This merch prize needs shipping info to fulfill.
    </div>

    <div style={{ display: "grid", gap: 8 }}>
      <input
        value={shippingForm.name}
        onChange={(e) => setShippingForm({ ...shippingForm, name: e.target.value })}
        placeholder="Full Name"
        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,.18)", background: "rgba(0,0,0,.25)", color: "white" }}
      />
      <input
        value={shippingForm.email}
        onChange={(e) => setShippingForm({ ...shippingForm, email: e.target.value })}
        placeholder="Email"
        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,.18)", background: "rgba(0,0,0,.25)", color: "white" }}
      />
      <input
        value={shippingForm.phone}
        onChange={(e) => setShippingForm({ ...shippingForm, phone: e.target.value })}
        placeholder="Phone"
        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,.18)", background: "rgba(0,0,0,.25)", color: "white" }}
      />
      <input
        value={shippingForm.address1}
        onChange={(e) => setShippingForm({ ...shippingForm, address1: e.target.value })}
        placeholder="Address Line 1"
        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,.18)", background: "rgba(0,0,0,.25)", color: "white" }}
      />
      <input
        value={shippingForm.address2}
        onChange={(e) => setShippingForm({ ...shippingForm, address2: e.target.value })}
        placeholder="Address Line 2 (optional)"
        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,.18)", background: "rgba(0,0,0,.25)", color: "white" }}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input
          value={shippingForm.city}
          onChange={(e) => setShippingForm({ ...shippingForm, city: e.target.value })}
          placeholder="City"
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,.18)", background: "rgba(0,0,0,.25)", color: "white" }}
        />
        <input
          value={shippingForm.state}
          onChange={(e) => setShippingForm({ ...shippingForm, state: e.target.value })}
          placeholder="State"
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,.18)", background: "rgba(0,0,0,.25)", color: "white" }}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input
          value={shippingForm.zip}
          onChange={(e) => setShippingForm({ ...shippingForm, zip: e.target.value })}
          placeholder="ZIP"
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,.18)", background: "rgba(0,0,0,.25)", color: "white" }}
        />
        <input
          value={shippingForm.country}
          onChange={(e) => setShippingForm({ ...shippingForm, country: e.target.value })}
          placeholder="Country (US)"
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,.18)", background: "rgba(0,0,0,.25)", color: "white" }}
        />
      </div>

      <button className="btn" onClick={onSubmitShipping} disabled={shipBusy} style={{ padding: "10px 12px" }}>
        {shipBusy ? "Saving…" : "Save Shipping"}
      </button>

      {shipMsg ? (
        <div className="prize-sub" style={{ marginTop: 8 }}>
          {shipMsg}
        </div>
      ) : null}
    </div>
  </div>
) : (
  <>
    {/* ✅ NFT wallet capture (ONLY if Ultra NFT + no wallet connected) */}
    {rarity === "ultra" && prize?.type === "nft" && !loadProfile()?.walletAddress ? (
      <div style={{ marginTop: 10, textAlign: "left" }}>
        <div className="prize-sub" style={{ marginBottom: 10 }}>
          ✅ Enter the wallet you want this NFT sent to (we’ll remember it for next time).
        </div>

        <input
          defaultValue={loadProfile()?.walletAddress || ""}
          onChange={(e) => {
            const next = String(e.target.value || "").trim();
            const p = loadProfile();
            saveProfile({ ...p, walletAddress: next });
          }}
          placeholder="0x… wallet address"
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,.18)",
            background: "rgba(0,0,0,.25)",
            color: "white",
          }}
        />

        <div className="prize-sub" style={{ marginTop: 8 }}>
          After you continue, your claim will show up in Admin → Claims.
        </div>
      </div>
    ) : (
      <div className="prize-sub">Tap continue to play again.</div>
    )}
  </>
)}
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
  z-index: 2147483647; /* 👈 always above header/tabs */
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

const { balance, spend, earn, claimDaily, devGrant, refresh } =
  usePoints(effectivePlayerId);

// ✅ Keep profile reactive (so UI updates when localStorage changes)
const [profile, setProfile] = React.useState<any>(() => {
  try {
    return loadProfile();
  } catch {
    return {};
  }
});

React.useEffect(() => {
  const sync = () => {
    try {
      setProfile(loadProfile());
    } catch {
      setProfile({});
    }
  };

  // initial
  sync();

  // whenever identity changes (wallet/discord connect/disconnect)
  window.addEventListener("ra:identity-changed", sync);
  return () => window.removeEventListener("ra:identity-changed", sync);
}, []);

// ✅ If returning from Discord OAuth, refresh identity immediately
React.useEffect(() => {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);

  if (params.get("discord") === "1") {
    window.dispatchEvent(new Event("ra:identity-changed"));
  }
}, []);  

const isDiscordConnected = !!profile?.discordUserId && !(profile as any)?.discordSkipLink;
  
// ✅ Whenever identity changes, force the points hook to refetch for the new id
const lastPidRef = React.useRef<string>("");

React.useEffect(() => {
  if (!effectivePlayerId) return;
  if (lastPidRef.current === effectivePlayerId) return;
  lastPidRef.current = effectivePlayerId;

  (async () => {
    try {
      await refresh();
    } catch {}
  })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [effectivePlayerId]);
  
// ✅ Run once guard (prevents React crash loops / duplicate linking)
const didDiscordLinkRef = React.useRef(false);

React.useEffect(() => {
  if (didDiscordLinkRef.current) return;
  didDiscordLinkRef.current = true;

  let cancelled = false;

  (async () => {
    try {
      // ✅ If user clicked "Disconnect", do NOT auto-reconnect on refresh
const gate = loadProfile();
if ((gate as any)?.discordSkipLink) return;

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
  discordSkipLink: false,
});

// ✅ CRITICAL: tell the app to recompute effectivePlayerId immediately
if (typeof window !== "undefined") {
  window.dispatchEvent(new Event("ra:identity-changed"));
}

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

// ✅ Merch shipping capture (only for merch)
const [lastClaimId, setLastClaimId] = useState<string>("");
const [lastPid, setLastPid] = useState<string>("");
const [needShipping, setNeedShipping] = useState<boolean>(false);
const [shipBusy, setShipBusy] = useState<boolean>(false);
const [shipMsg, setShipMsg] = useState<string>("");

const [shippingForm, setShippingForm] = useState<any>({
  name: "",
  email: "",
  phone: "",
  address1: "",
  address2: "",
  city: "",
  state: "",
  zip: "",
  country: "US",
});
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
  // ✅ Determine player identity ONCE (wins MUST follow effective identity)
  const prof = loadProfile();
  const pid =
    String(effectivePlayerId || getEffectivePlayerId(prof) || prof?.id || "guest")
      .trim()
      .slice(0, 64) || "guest";

  const pname =
    (prof?.discordName || playerName || prof?.name || "guest").trim() || "guest";

  // ✅ Roll rarity + prize ON THE SERVER (Model C enforced server-side)
  const rollRes = await fetch("/api/prizes/roll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId: pid }),
  });

  const rollJson = await rollRes.json().catch(() => null);

  if (!rollRes.ok || !rollJson?.ok) {
    console.warn("Prize roll failed:", rollRes.status, rollJson);
    setBusy(false);
    return;
  }

  const r = rollJson.rarity as any;
  let pz = rollJson.prize as any;

// ✅ Merch auto-claim (creates claim immediately, then modal captures shipping)
setNeedShipping(false);
setShipMsg("");
setLastClaimId("");
setLastPid(pid);

if (String(pz?.type || "").toLowerCase() === "merch") {
  const claimId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const cr = await fetch("/api/prizes/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      claimId,
      playerId: pid,
      prize: pz,
      wallet: null,
      shipping: null,
    }),
  });

  const cj = await cr.json().catch(() => null);

  if (cr.ok && cj?.ok) {
    setLastClaimId(claimId);
    setNeedShipping(!!cj.needShipping);
  } else {
    console.warn("Merch claim failed:", cr.status, cj);
    setShipMsg(cj?.error || "Merch claim failed");
  }
}  

  // ✅ If prize is points, credit them via /api/points/earn (respects daily cap)
  if (pz?.type === "points" && Number(pz?.points || 0) > 0) {
    const earnRes: any = await earn(Number(pz.points || 0));

    if (earnRes?.ok === false) {
      console.warn("EARN failed:", earnRes);
    }

    const applied = Number(earnRes?.added ?? earnRes?.applied ?? pz.points);

    // If daily cap limited the reward
    if (Number.isFinite(applied) && applied < Number(pz.points || 0)) {
      pz = {
        ...pz,
        label: `Daily cap reached — prize rolled, but only ${applied} ${
          pointsConfig.currency || "REBEL"
        } could be credited today.`,
      };
    }

    await refresh();
  }

  // ✅ Save what the user won so the modal can show it
  setPrize(pz);

  // ✅ Wins tracking: pointsAwarded only if points
  const pointsAwarded = pz?.type === "points" ? Number(pz?.points || 0) : 0;

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

    // ✅ IMPORTANT: record wins to the same identity used for points
    playerId: effectivePlayerId || pid,
    playerName: prof?.discordName || prof?.name || pname,

    rarity: r,
    pointsAwarded,

    // ✅ KEY: let the server know if this win had a real prize
    // (points wins will usually have prize null)
    prize: pz?.type && pz.type !== "points" ? pz : null,
  }),
}).catch(() => {});

window.dispatchEvent(new Event("ra:leaderboards-refresh"));
  
setRarity(r);
setPhase("revealed");
setShowPrize(true);
setBusy(false);
    }, 350);
  };
 const resetAfterPrize = async () => {
  try {
    // ✅ If the prize was an NFT, create a claim
    if (prize && prize.type === "nft" && prize.meta) {
     const wallet = loadProfile()?.walletAddress || "";

      await fetch("/api/claims/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: effectivePlayerId,
          wallet,
          prize: prize,
        }),
      });
    }
  } catch (e) {
    console.error("Claim creation failed", e);
  }

  setShowPrize(false);
  setRarity("none");
  setWinText("");
  setPrize(null);
  setProgress(0);
  setOrder(Array.from({ length: EGG_COUNT }, (_, i) => i));
  setPhase("idle");
};

// ✅ Leaderboards (server summary)
const [lb, setLb] = React.useState<{
  balance: { playerId: string; score: number }[];
  earned: { playerId: string; score: number }[];
  wins: { playerId: string; score: number }[];
  recentWins: any[];
}>({
  balance: [],
  earned: [],
  wins: [],
  recentWins: [],
});

async function loadLeaderboards() {
  try {
    const r = await fetch("/api/leaderboard/summary", { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return;
    setLb({
      balance: Array.isArray(j.balance) ? j.balance : [],
      earned: Array.isArray(j.earned) ? j.earned : [],
      wins: Array.isArray(j.wins) ? j.wins : [],
      recentWins: Array.isArray(j.recentWins) ? j.recentWins : [],
    });
  } catch {}
}

// ✅ Load once on mount
React.useEffect(() => {
  loadLeaderboards();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

// ✅ Live-refresh leaderboards when a win is recorded (no page refresh needed)
React.useEffect(() => {
  const onRefresh = () => loadLeaderboards();
  window.addEventListener("ra:leaderboards-refresh", onRefresh);
  return () => window.removeEventListener("ra:leaderboards-refresh", onRefresh);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

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

function disconnectDiscord() {
  try {
    const p: any = loadProfile() || {};
    const fallback = (p.walletAddress ? `wallet:${p.walletAddress}` : (p.id || "guest")).trim();

    // ✅ Clear discord identity using saveProfile (now supports clearing)
    saveProfile({
      discordUserId: undefined,
      discordName: undefined,
      primaryId: fallback,
      // keep this if you're using it to block auto-link
      discordSkipLink: true as any,
    } as any);

    window.dispatchEvent(new Event("ra:identity-changed"));
  } catch {}

  // ✅ log out server-side (clears httpOnly cookie)
  window.location.href = "/api/auth/discord/logout";
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
        idempotencyKey: idem,
      }),
    });

    const j = await r.json().catch(() => null);

    if (!r.ok || !j?.ok) {
      setDripStatus(j?.error || "Migrate failed.");
      if (typeof j?.dripBalance === "number") setDripBalance(j.dripBalance);
      return;
    }

    setDripStatus(`✅ Migrated ${amt} points into the game.`);
    await refresh();

    const br = await fetch("/api/drip/balance", { cache: "no-store" });
    const bj = await br.json().catch(() => null);
    if (br.ok && bj?.ok) setDripBalance(Number(bj.balance || 0));
  } catch (e: any) {
    setDripStatus(e?.message || "Migrate error");
  } finally {
    setDripBusy(false);
  }
}

// ✅ put submitShipping HERE (outside migrateDripNow, but still inside Shuffle component)
async function submitShipping() {
  if (!lastClaimId || !lastPid) {
    setShipMsg("Missing claimId/playerId");
    return;
  }

  setShipBusy(true);
  setShipMsg("");

  try {
    const r = await fetch("/api/prizes/shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimId: lastClaimId,
        playerId: lastPid,
        shipping: shippingForm,
      }),
    });

    const j = await r.json().catch(() => null);

    if (!r.ok || !j?.ok) {
      setShipMsg(j?.error || "Could not save shipping.");
      return;
    }

    setShipMsg("✅ Shipping saved! We’ll email you when it ships.");
// ✅ IMPORTANT: do NOT setNeedShipping(false) here
  } catch (e: any) {
    setShipMsg(e?.message || "Shipping error");
  } finally {
    setShipBusy(false);
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

        <div
  className="shuffle-scene ant-scene"
  style={{ position: "relative", minHeight: 420, overflow: "hidden" }}
>
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
<div style={{ height: 44, display: "flex", alignItems: "center" }}>
 <button
  className="btn"
  onClick={runShuffle}
  disabled={busy || phase === "shuffling" || needMore > 0}
  title={needMore > 0 ? "Not enough points" : ""}
  style={{
    position: "relative",
    minWidth: 240,           // ✅ keeps row from reflowing
    height: 44,              // ✅ consistent height
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  }}
>
  {/* ✅ reserve the “largest” label width so layout never shifts */}
  <span style={{ visibility: "hidden" }}>
    {`Shuffle (-${cost} ${pointsConfig.currency})`}
  </span>

  {/* ✅ real visible label */}
  <span
    style={{
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    {phase === "shuffling"
      ? "Shuffling…"
      : `Shuffle (-${cost} ${pointsConfig.currency})`}
  </span>
</button>
</div>

 <button
  className="btn"
  type="button"
  onClick={() => setShowBuyPoints(true)}
  style={{ padding: "10px 12px", fontSize: 13, opacity: 0.95 }}
  title="Connect Ape wallet and buy points with APE"
>
  Buy Points / Connect Ape Wallet
</button>

{isDiscordConnected ? (
  <button
    className="btn"
    type="button"
    onClick={disconnectDiscord}
    style={{ padding: "10px 12px", fontSize: 13, opacity: 0.95 }}
  >
    Disconnect Discord
  </button>
) : (
  <button
    className="btn"
    type="button"
    onClick={() => {
      try {
        // ✅ Explicitly clear the gate (deleting won't work with saveProfile merge rules)
        saveProfile({ discordSkipLink: false });
        window.dispatchEvent(new Event("ra:identity-changed"));
      } catch {}

      window.location.href = "/api/auth/discord/login";
    }}
    style={{ padding: "10px 12px", fontSize: 13, opacity: 0.95 }}
  >
    Connect Discord
  </button>
)}

<div style={{ fontSize: 12, opacity: 0.8 }}>
  Discord: <b>{isDiscordConnected ? "Connected ✅" : "Not Connected ❌"}</b>
</div>
  
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
  • Crates can award <b>REBEL Points</b> and occasionally <b>collectibles/merch</b> when enabled.<br />
  • Daily claim: <b>+{pointsConfig.dailyClaim}</b> {pointsConfig.currency} (once per day).<br />
  • Daily earn cap: <b>{pointsConfig.dailyEarnCap}</b> {pointsConfig.currency}/day (anti-abuse).<br />
  • Optional: you can buy points with <b>APE</b> (final sale, gas may apply).<br />
  • See <a href="/rules" style={{ textDecoration: "underline" }}>Official Rules</a> for details.
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
  Identity: <b>{playerName || effectivePlayerId}</b>
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
    if (!isDiscordConnected) return;
    await openDripModal();
  }}
  disabled={dripBusy || !isDiscordConnected}
  style={{ padding: "8px 12px", fontSize: 13 }}
  title={
    isDiscordConnected
      ? "Move points from Discord (DRIP) into the game."
      : "Connect Discord to migrate DRIP points."
  }
>
  {dripBusy
    ? "Loading DRIP…"
    : isDiscordConnected
    ? "Migrate Points from DRIP in Discord"
    : "Connect Discord for DRIP"}
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

   {showPrize && (
  <PrizeModal
    rarity={rarity}
    prize={prize}
    onClose={() => setShowPrize(false)}
    needShipping={needShipping}
    shippingForm={shippingForm}
    setShippingForm={setShippingForm}
    shipBusy={shipBusy}
    shipMsg={shipMsg}
    onSubmitShipping={submitShipping}
  />
)}
        
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
          z-index: 10;
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
