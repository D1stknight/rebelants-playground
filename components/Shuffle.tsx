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

// ── Shuffle Audio ─────────────────────────────────────────────────────────────
function useShuffleAudio() {
  const [muted, setMuted] = React.useState<boolean>(() => {
    try { return localStorage.getItem("ra:shuffle:muted") === "1"; } catch { return false; }
  });
  const mutedRef = React.useRef(muted);
  mutedRef.current = muted;
  const musicRef = React.useRef<HTMLAudioElement | null>(null);

  const play = React.useCallback((src: string, volume = 1) => {
    if (typeof window === "undefined") return;
    try { const a = new Audio(src); a.volume = volume; void a.play().catch(()=>{}); } catch {}
  }, []);

  const startMusic = React.useCallback(() => {
    if (typeof window === "undefined") return;
    if (musicRef.current) { musicRef.current.pause(); musicRef.current = null; }
    try {
      const a = new Audio("/audio/shuffle-music.mp3");
      a.loop = true; a.volume = mutedRef.current ? 0 : 0.4;
      void a.play().catch(()=>{}); musicRef.current = a;
    } catch {}
  }, [muted]);

  const stopMusic = React.useCallback(() => {
    if (musicRef.current) { musicRef.current.pause(); musicRef.current.currentTime = 0; musicRef.current = null; }
  }, []);

  const toggleMute = React.useCallback(() => {
    setMuted(m => {
      const next = !m;
      try { localStorage.setItem("ra:shuffle:muted", next ? "1" : "0"); } catch {}
      if (musicRef.current) musicRef.current.volume = next ? 0 : 0.4;
      return next;
    });
  }, []);

  const sfx = React.useMemo(() => ({
    pick:   () => { stopMusic(); },
    common: () => { if (!mutedRef.current) play("/audio/prize-common.mp3", 0.8); },
    rare:   () => { if (!mutedRef.current) play("/audio/prize-rare.mp3",   0.9); },
    ultra:  () => { if (!mutedRef.current) play("/audio/prize-ultra.mp3",  1.0); },
    none:   () => { if (!mutedRef.current) play("/audio/prize-none.mp3",   0.8); },
  }), [play, stopMusic]);

  return { muted, toggleMute, startMusic, stopMusic, sfx };
}
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
    return Number.isFinite(pts) && pts > 0
      ? pointsPrize(pts)
      : { type: "none", label: "Nothing this time" };
  }

  // Rare = points only (bigger) AND very occasionally merch
  if (rarity === "rare") {
    const merchChance = Number(pointsConfig?.rareMerchChance ?? 0.01); // default 1%
    const roll = Math.random();

    if (roll < merchChance) {
      const pool = (pointsConfig?.prizePools?.rare || []) as any[];
      const merchOnly = pool.filter(
        (p) => String(p?.type || "").toUpperCase() === "MERCH"
      );
      const picked = pickWeightedPrize(merchOnly);

      if (picked) {
        return {
          type: "merch",
          label: String(picked?.label || "Merch Prize"),
          meta: picked,
        };
      }
      // if no merch available, fall back to points
    }

    const pts = Number(pointsConfig?.rewards?.rare ?? defaultPts);
    return Number.isFinite(pts) && pts > 0
      ? pointsPrize(pts)
      : { type: "none", label: "Nothing this time" };
  }

  // Ultra = try NFT first; if none available -> points fallback higher than rare
  if (rarity === "ultra") {
    const pool = (pointsConfig?.prizePools?.ultra || []) as any[];
    const nftOnly = pool.filter(
      (p) => String(p?.type || "").toUpperCase() === "NFT"
    );
    const picked = pickWeightedPrize(nftOnly);

    if (picked) {
      return {
        type: "nft",
        label: String(picked?.label || "NFT Prize"),
        meta: picked,
      };
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
  // spread evenly — centered within scene
  const min = 7;
  const max = 77;
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

     <button
  className="btn"
  onClick={async () => {
    try {
      // ✅ If it's an NFT prize, create a claim BEFORE closing
      if (prize?.type === "nft") {
        const p = loadProfile();

        // Prefer connected wallet, else use what user typed
        const wallet =
          (p as any)?.walletAddress ||
          (shippingForm as any)?.walletAddress ||
          "";

        if (!wallet) {
          alert("Please enter a wallet address first.");
          return;
        }

       const r = await fetch("/api/prizes/claim", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    claimId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    playerId: getEffectivePlayerId(loadProfile()),
    prize,
    wallet: wallet,
    shipping: null,
  }),
});

        const j = await r.json().catch(() => null);

        if (!r.ok || !j?.ok) {
          console.log("CLAIM CREATE FAILED", r.status, j);
          alert(`Claim failed (${r.status}). Check console.`);
          return;
        }

        console.log("✅ CLAIM CREATED", j);
      }
    } catch (e: any) {
      console.log("CLAIM CREATE ERROR", e);
      alert(`Claim error: ${String(e?.message || e)}`);
      return;
    }

    onClose();
  }}
>
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

  // Start music on mount, stop on unmount
  React.useEffect(() => { startMusic(); return () => { stopMusic(); }; }, []);

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

const {
  balance,
  earnedToday,
  capBank,
  dailyCap,
  remainingDaily,
  totalEarnRoom,
  spend,
  earn,
  claimDaily,
  devGrant,
  refresh,
} = usePoints(effectivePlayerId);

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
const { muted: shuffleMuted, toggleMute: toggleShuffleMute, startMusic, stopMusic, sfx: shuffleSfx } = useShuffleAudio();
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
  const [showRules, setShowRules] = useState(false);
const [dripBalance, setDripBalance] = useState<number | null>(null);

const [dripAmount, setDripAmount] = useState<number>(0);
const [dripBusy, setDripBusy] = useState(false);
const [dripStatus, setDripStatus] = useState("");
const [showDripFix, setShowDripFix] = useState(false);

// ==============================
// ✅ ADD DAILY CLAIM BLOCK HERE
// ==============================

const [dailyClaimed, setDailyClaimed] = useState(false);
const [claimStatus, setClaimStatus] = useState("");
const [claimBusy, setClaimBusy] = useState(false);
const [msUntilNextClaim, setMsUntilNextClaim] = useState(0);
const [nextClaimAt, setNextClaimAt] = useState("");

function formatClaimCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

async function refreshClaimStatus(pid: string) {
  try {
    const r = await fetch(
      `/api/points/claim?playerId=${encodeURIComponent(pid)}`,
      { cache: "no-store" }
    );
    const j = await r.json().catch(() => null);

    if (r.ok && j?.ok) {
      setDailyClaimed(!!j.claimed);
      setMsUntilNextClaim(Number(j.msUntilNextClaim || 0));
      setNextClaimAt(String(j.nextClaimAt || ""));
    }
  } catch {}
}

React.useEffect(() => {
  if (!effectivePlayerId) return;
  refreshClaimStatus(effectivePlayerId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [effectivePlayerId]);

React.useEffect(() => {
  if (!dailyClaimed || msUntilNextClaim <= 0) return;

  const interval = setInterval(() => {
    setMsUntilNextClaim((prev) => Math.max(0, prev - 1000));
  }, 1000);

  return () => clearInterval(interval);
}, [dailyClaimed, msUntilNextClaim]);

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
    await refreshClaimStatus(effectivePlayerId);
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

  if (Number(totalEarnRoom || 0) <= 0) {
    setWinText("No play room left today. Buy a pack to keep playing.");
    return;
  }

  const spendRes = await spend(cost, "shuffle");

  if (!spendRes?.ok) {
    setWinText(
      spendRes?.error || "No play room left today. Buy a pack to keep playing."
    );
    return;
  }

  setWinText("");
  setBusy(true);
  setPhase("shuffling"); startMusic();
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
    shuffleSfx.pick();
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
if (r === "ultra") shuffleSfx.ultra();
else if (r === "rare") shuffleSfx.rare();
else if (r === "common") shuffleSfx.common();
else shuffleSfx.none();
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

  stopMusic();
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
      const rawError = String(j?.error || "Migrate failed.");

      if (
        rawError.toLowerCase().includes("drip credential not found") ||
        rawError.toLowerCase().includes("user must link drip first")
      ) {
        setDripStatus("No DRIP Discord link found yet.");
        setShowDripFix(true);
      } else {
        setDripStatus(rawError);
        setShowDripFix(false);
      }

      if (typeof j?.dripBalance === "number") setDripBalance(j.dripBalance);
      return;
    }

    setDripStatus(`✅ Migrated ${amt} points into the game.`);
    setShowDripFix(false);
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
      {/* ── PARTICLES ── */}
      <div style={{ position:'fixed', inset:0, zIndex:0, pointerEvents:'none', overflow:'hidden' }}>
        {[...Array(30)].map((_,i) => (
          <div key={i} style={{
            position:'absolute',
            bottom:'-4px',
            left: `${(i*97+13)%100}%`,
            width: 2+(i%3),
            height: 2+(i%3),
            borderRadius:'50%',
            background: i%3===0?'#a78bfa':i%3===1?'#fbbf24':'#c084fc',
            opacity: 0.12+(i%5)*0.06,
            animation: `shuffleFloat ${6+(i%5)*1.8}s ${(i*0.7)%8}s infinite linear`,
          }} />
        ))}
      </div>

      {/* ── FULL PAGE BG ── */}
      <div style={{ position:'fixed', inset:0, zIndex:0, pointerEvents:'none',
        background:'radial-gradient(ellipse at 50% 30%, rgba(109,40,217,0.15) 0%, rgba(5,3,15,0.0) 60%), linear-gradient(160deg, #060412 0%, #0d0520 40%, #080318 100%)',
        backgroundImage: `url("${shuffleConfig.pageBg}")`,
        backgroundSize:'cover', backgroundPosition:'center', filter:'saturate(0.7) brightness(0.45)'
      }} />
      <div style={{ position:'fixed', inset:0, zIndex:1, pointerEvents:'none',
        background:'linear-gradient(160deg, rgba(6,4,18,0.75) 0%, rgba(13,5,32,0.6) 50%, rgba(6,4,18,0.85) 100%)'
      }} />

      {/* ── HEADER ── */}
      <header style={{ position:'relative', zIndex:20, maxWidth:980, margin:'0 auto', padding:'16px 20px 0', display:'flex', alignItems:'center', justifyContent:'space-between', fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif" }}>
        <Link href="/" style={{ display:'flex', alignItems:'center', gap:10, textDecoration:'none', color:'white' }}>
          <span style={{ fontSize:20, filter:'drop-shadow(0 0 8px rgba(167,139,250,0.6))' }}>←</span>
          <span style={{ fontSize:11, fontWeight:900, letterSpacing:'0.2em', textTransform:'uppercase', color:'rgba(255,255,255,0.5)' }}>REBEL ANTS</span>
        </Link>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ fontSize:13, fontWeight:900, letterSpacing:'0.1em', color:'#fbbf24', filter:'drop-shadow(0 0 8px rgba(251,191,36,0.5))' }}>
            ⚡ {balance} <span style={{ fontSize:10, color:'rgba(251,191,36,0.6)' }}>REBEL</span>
          </div>
          <button onPointerDown={e=>{e.preventDefault();toggleShuffleMute();}}
            style={{ background:'rgba(0,0,0,0.4)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:20, padding:'6px 12px', cursor:'pointer', fontSize:15, color:'rgba(255,255,255,0.8)', minWidth:40, minHeight:40, touchAction:'manipulation' }}>
            {shuffleMuted ? '🔇' : '🔊'}
          </button>
        </div>
      </header>

      {/* ── MAIN CONTENT ── */}
      <div style={{ position:'relative', zIndex:10, maxWidth:980, margin:'0 auto', padding:'12px 16px 40px', fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif" }}>

        {/* Title */}
        <div style={{ textAlign:'center', marginBottom:8 }}>
          <div style={{ fontSize:'clamp(22px,4vw,38px)', fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase',
            background:'linear-gradient(135deg,#e9d5ff,#a78bfa,#7c3aed,#fbbf24)',
            WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text',
            filter:'drop-shadow(0 0 20px rgba(167,139,250,0.4))',
          }}>QUEEN&apos;S EGG SHUFFLE</div>
          <div style={{ fontSize:12, letterSpacing:'0.25em', color:'rgba(255,255,255,0.35)', textTransform:'uppercase', marginTop:4 }}>
            {EGG_COUNT} EGGS · ONE FATE · CHOOSE WISELY
          </div>
        </div>

        {/* ── GAME SCENE ── */}
        <div style={{ position:'relative', minHeight:460, borderRadius:24, overflow:'hidden', marginBottom:20,
          background:'linear-gradient(180deg, rgba(30,5,60,0.85) 0%, rgba(10,2,30,0.95) 100%)',
          border:'1px solid rgba(167,139,250,0.2)',
          boxShadow:'0 0 60px rgba(109,40,217,0.2), 0 0 120px rgba(109,40,217,0.08), inset 0 1px 0 rgba(167,139,250,0.15)',
        }}>

          {/* Scene BG image */}
          <div style={{ position:'absolute', inset:0, zIndex:0, pointerEvents:'none',
            backgroundImage: `linear-gradient(180deg, rgba(20,4,50,0.4), rgba(5,1,18,0.7)), url("${shuffleConfig.cardBg}")`,
            backgroundSize:'cover', backgroundPosition:'center',
          }} />

          {/* Purple vignette overlay */}
          <div style={{ position:'absolute', inset:0, zIndex:1, pointerEvents:'none',
            background:'radial-gradient(ellipse at 50% 0%, rgba(109,40,217,0.18) 0%, transparent 65%)',
          }} />

          {/* Queen aura */}
          <div style={{ position:'absolute', left:'50%', transform:'translateX(-50%)', top:30, width:200, height:200,
            background:'radial-gradient(ellipse, rgba(167,139,250,0.25) 0%, rgba(109,40,217,0.12) 40%, transparent 70%)',
            zIndex:2, pointerEvents:'none',
            animation: phase==='shuffling' ? 'queenAuraActive 0.6s ease-in-out infinite alternate' : 'queenAura 3s ease-in-out infinite alternate',
          }} />

          {/* Queen 3D — centered, pushed down from top */}
          <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%, -68%)', zIndex:3, pointerEvents:'none' }}>
            <Queen3D active={phase === "shuffling"} scale={shuffleConfig.queenScale} y={-0.1} />
          </div>

          {/* Rails */}
          <div className="rail rail-top" style={{ zIndex:4 }} />
          <div className="rail rail-bottom" style={{ zIndex:4 }} />

          {/* Progress */}
          <div style={{ position:'relative', zIndex:5 }}>
            <AntProgress progress={progress} />
          </div>

          {/* Eggs */}
          {Array.from({ length: EGG_COUNT }, (_, i) => (
            <button
              key={i}
              className={`egg-card ${phase === "pick" ? "can-pick" : ""}`}
              style={{
                left: `${LANES[order[i]]}%`,
                top: "72%",
                zIndex: 6,
                filter: phase==='pick'
                  ? 'drop-shadow(0 0 12px rgba(167,139,250,0.7)) drop-shadow(0 0 24px rgba(167,139,250,0.3))'
                  : 'drop-shadow(0 4px 8px rgba(0,0,0,0.5))',
                transform: phase==='pick' ? 'perspective(400px) rotateX(-5deg)' : 'perspective(400px) rotateX(0deg)',
                transition:'all 0.3s ease',
              }}
              onClick={onPick}
              disabled={phase !== "pick" || busy}
              aria-label="Pick egg"
            >
              <div className={`egg-body ${phase === "pick" ? "wobble-on-pick" : ""}`} style={{
                background: phase==='pick'
                  ? undefined
                  : undefined,
                boxShadow: phase==='pick'
                  ? 'inset -6px -8px 20px rgba(0,0,0,0.4), inset 4px 4px 12px rgba(255,255,220,0.5), 0 8px 24px rgba(0,0,0,0.5), 0 0 30px rgba(251,191,36,0.5), 0 0 60px rgba(251,191,36,0.2)'
                  : 'inset -6px -8px 20px rgba(0,0,0,0.4), inset 4px 4px 12px rgba(255,255,200,0.3), 0 8px 24px rgba(0,0,0,0.5)',
              }} />
              <div className="egg-shadow" />
              <div className="egg-speckle" style={{ opacity: phase==='pick' ? 0.3 : 0.5 }} />
            </button>
          ))}

          {/* Phase overlay — shuffling flash */}
          {phase === 'shuffling' && (
            <div style={{ position:'absolute', inset:0, zIndex:7, pointerEvents:'none',
              background:'radial-gradient(ellipse at 50% 50%, rgba(167,139,250,0.08) 0%, transparent 60%)',
              animation:'shuffleFlash 0.4s ease-in-out infinite alternate',
            }} />
          )}

          {/* Pick phase invitation */}
          {phase === 'pick' && (
            <div style={{ position:'absolute', bottom:16, left:'50%', transform:'translateX(-50%)', zIndex:8,
              fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", fontSize:12, fontWeight:900, letterSpacing:'0.25em', textTransform:'uppercase',
              color:'#a78bfa', animation:'pickPulse 1.5s ease-in-out infinite',
              textShadow:'0 0 12px rgba(167,139,250,0.8)',
            }}>
              ✦ CHOOSE YOUR EGG ✦
            </div>
          )}
        </div>

        {/* ── ACTION ROW ── */}
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:16 }}>

          {/* Shuffle Button — main CTA */}
          <button
            onClick={runShuffle}
            disabled={busy || phase === "shuffling" || needMore > 0}
            title={needMore > 0 ? "Not enough points" : ""}
            style={{
              fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif",
              position:'relative', minWidth:220, height:48,
              display:'inline-flex', alignItems:'center', justifyContent:'center',
              fontSize:13, fontWeight:900, letterSpacing:'0.2em', textTransform:'uppercase',
              background: (busy || needMore>0) ? 'rgba(109,40,217,0.15)' : 'linear-gradient(135deg,#7c3aed,#a855f7,#7c3aed)',
              backgroundSize:'200% 100%',
              border: (busy || needMore>0) ? '2px solid rgba(109,40,217,0.3)' : '2px solid rgba(167,139,250,0.6)',
              borderRadius:50, color:'white', cursor: (busy||needMore>0) ? 'not-allowed' : 'pointer',
              opacity: (busy||needMore>0) ? 0.55 : 1,
              boxShadow: (busy||needMore>0) ? 'none' : '0 0 20px rgba(109,40,217,0.5), 0 0 40px rgba(109,40,217,0.2)',
              animation: (!busy && needMore===0) ? 'btnGlow 2.5s ease-in-out infinite' : 'none',
              transition:'all 0.2s',
            }}
          >
            <span style={{ visibility:'hidden', position:'absolute' }}>{`Shuffle (-${cost} ${pointsConfig.currency})`}</span>
            <span style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
              {phase === "shuffling" ? "✦ SHUFFLING..." : `⚔️ SHUFFLE (-${cost} ${pointsConfig.currency})`}
            </span>
          </button>

          {/* Buy Points */}
          <button onClick={() => setShowBuyPoints(true)}
            style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", padding:'10px 16px', fontSize:11, fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase',
              background:'rgba(251,191,36,0.1)', border:'1px solid rgba(251,191,36,0.35)', borderRadius:50,
              color:'#fbbf24', cursor:'pointer', whiteSpace:'nowrap',
              boxShadow:'0 0 12px rgba(251,191,36,0.15)', transition:'all 0.2s',
            }}>
            💎 BUY POINTS
          </button>

          {/* Discord */}
          {isDiscordConnected ? (
            <button onClick={disconnectDiscord}
              style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", padding:'10px 14px', fontSize:11, fontWeight:900, letterSpacing:'0.12em', textTransform:'uppercase',
                background:'rgba(88,101,242,0.12)', border:'1px solid rgba(88,101,242,0.3)', borderRadius:50, color:'#a5b4fc', cursor:'pointer', whiteSpace:'nowrap' }}>
              ✓ DISCORD
            </button>
          ) : (
            <button onClick={() => { try { saveProfile({ discordSkipLink: false }); window.dispatchEvent(new Event('ra:identity-changed')); } catch {} window.location.href = '/api/auth/discord/login'; }}
              style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", padding:'10px 14px', fontSize:11, fontWeight:900, letterSpacing:'0.12em', textTransform:'uppercase',
                background:'#5865F2', border:'none', borderRadius:50, color:'white', cursor:'pointer', whiteSpace:'nowrap',
                boxShadow:'0 0 16px rgba(88,101,242,0.4)' }}>
              CONNECT DISCORD
            </button>
          )}

          {/* Balance */}
          <div style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", fontSize:12, letterSpacing:'0.1em', color:'rgba(255,255,255,0.5)', textTransform:'uppercase' }}>
            <span style={{ color:'#fbbf24', fontWeight:900 }}>{balance}</span> {pointsConfig.currency}
          </div>

          {needMore > 0 && (
            <span style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", fontSize:11, color:'#f87171', letterSpacing:'0.1em', textTransform:'uppercase' }}>
              NEED {needMore} MORE
            </span>
          )}
        </div>

        {/* ── INFO STRIP ── */}
        <div style={{ display:'flex', gap:16, flexWrap:'wrap', alignItems:'center', marginBottom:12,
          padding:'12px 16px', borderRadius:14,
          background:'rgba(255,255,255,0.03)', border:'1px solid rgba(167,139,250,0.1)',
        }}>
          {/* Costs */}
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            {[
              { label:'COST', val:`${pointsConfig.shuffleCost} ${pointsConfig.currency}`, col:'#f87171' },
              { label:'COMMON', val:`+${pointsConfig.rewards.common}`, col:'#34d399' },
              { label:'RARE', val:`+${pointsConfig.rewards.rare}`, col:'#a78bfa' },
              { label:'ULTRA', val:`+${pointsConfig.rewards.ultra}`, col:'#fbbf24' },
            ].map(item => (
              <div key={item.label} style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", fontSize:10, letterSpacing:'0.12em', textTransform:'uppercase' }}>
                <span style={{ color:'rgba(255,255,255,0.35)' }}>{item.label} </span>
                <span style={{ color:item.col, fontWeight:900 }}>{item.val}</span>
              </div>
            ))}
          </div>

          <div style={{ flex:1 }} />

          {/* Claim Daily */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:2 }}>
            <button onClick={claimDailyNow} disabled={claimBusy || dailyClaimed}
              style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", padding:'7px 14px', fontSize:10, fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase',
                background: dailyClaimed ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg,#ef4444,#f97316)',
                border: dailyClaimed ? '1px solid rgba(255,255,255,0.1)' : 'none',
                borderRadius:50, color: dailyClaimed ? 'rgba(255,255,255,0.3)' : 'white',
                cursor: dailyClaimed ? 'not-allowed' : 'pointer', whiteSpace:'nowrap',
                boxShadow: dailyClaimed ? 'none' : '0 0 12px rgba(239,68,68,0.3)',
              }}>
              {dailyClaimed ? `✓ CLAIMED · NEXT IN ${formatClaimCountdown(msUntilNextClaim)}` : `⚡ CLAIM +${pointsConfig.dailyClaim} REBEL`}
            </button>
          </div>

          {/* DRIP migrate */}
          {isDiscordConnected && (
            <button onClick={async () => { if (isDiscordConnected) await openDripModal(); }} disabled={dripBusy}
              style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", padding:'7px 12px', fontSize:10, fontWeight:900, letterSpacing:'0.12em', textTransform:'uppercase',
                background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:50, color:'rgba(255,255,255,0.5)', cursor:'pointer', whiteSpace:'nowrap' }}>
              {dripBusy ? 'LOADING...' : 'MIGRATE DRIP'}
            </button>
          )}
        </div>

        {/* Official Rules */}
        <div style={{ marginBottom:20 }}>
          <button onClick={() => setShowRules(true)}
            style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", fontSize:10, letterSpacing:'0.12em', textTransform:'uppercase',
              background:'transparent', border:'none', color:'rgba(255,255,255,0.3)', cursor:'pointer', textDecoration:'underline' }}>
            OFFICIAL RULES
          </button>
        </div>

        {/* ── LEADERBOARD ── */}
        <div style={{ borderRadius:18, border:'1px solid rgba(167,139,250,0.15)',
          background:'rgba(10,4,25,0.6)', backdropFilter:'blur(12px)',
          padding:16, boxShadow:'0 0 30px rgba(109,40,217,0.1)',
        }}>
          <LeaderboardPanel />
        </div>

        {/* Copyright */}
        <div style={{ textAlign:'center', padding:'16px 0 4px', fontSize:10, opacity:0.25, color:'white', letterSpacing:'0.06em', userSelect:'none', fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", textTransform:'uppercase' }}>
          © 2026 REBEL ANTS LLC · DEVELOPED BY MIGUEL CONCEPCION
        </div>
      </div>

      {/* ── MODALS (all preserved exactly) ── */}
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

      {showRules && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', zIndex:3000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={()=>setShowRules(false)}>
          <div style={{ background:'#0f172a', border:'1px solid rgba(255,255,255,0.15)', borderRadius:16, padding:28, maxWidth:560, width:'100%', maxHeight:'85vh', overflowY:'auto' }} onClick={e=>e.stopPropagation()}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
              <div style={{ fontWeight:900, fontSize:18 }}>📋 Official Rules</div>
              <button onClick={()=>setShowRules(false)} style={{ background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:8, padding:'6px 14px', color:'white', cursor:'pointer', fontSize:13 }}>✕ Close</button>
            </div>
            <div style={{ fontSize:13, lineHeight:1.7, display:'flex', flexDirection:'column', gap:12, opacity:0.9 }}>
              <p><b>Free-to-play.</b> No purchase necessary to play. Void where prohibited.</p>
              <p><b>Game currency:</b> REBEL Points are an in-app promotional points system. No guaranteed cash value, not redeemable for cash.</p>
              <p><b>Optional purchase (APE):</b> You may optionally buy REBEL Points using APE. <b>All purchases are final</b>. Gas fees may apply.</p>
              <p><b>Prizes:</b> Crates may award REBEL Points and/or digital collectibles and/or merch when available.</p>
              <p><b>Daily limits:</b> Daily claim and play limits apply. Daily plays reset every 24 hours. Purchased bonus plays do not expire.</p>
              <p><b>Fair play:</b> Multi-accounting, bots, or exploits may result in disqualification.</p>
              <p style={{ opacity:0.7 }}>By playing, you agree to these rules.</p>
            </div>
          </div>
        </div>
      )}

      <BuyPointsModal
        open={showBuyPoints}
        onClose={() => setShowBuyPoints(false)}
        playerId={effectivePlayerId}
        onClaimed={async () => { await refresh(); }}
      />

      {showDripMigrate && (
        <div style={{ position:'fixed', inset:0, zIndex:2500, background:'rgba(0,0,0,.55)', display:'grid', placeItems:'center', padding:16 }} role="dialog" aria-modal="true">
          <div style={{ width:'min(520px, 95vw)', borderRadius:16, border:'1px solid rgba(255,255,255,.18)', background:'rgba(15,23,42,.96)', boxShadow:'0 28px 60px rgba(0,0,0,.55)', padding:16, color:'white' }}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'center' }}>
              <div style={{ fontWeight:900, fontSize:16 }}>Migrate DRIP Points → Game</div>
              <button className="btn" onClick={() => setShowDripMigrate(false)} style={{ padding:'8px 12px' }}>Close</button>
            </div>
            <div style={{ marginTop:10, fontSize:13, opacity:0.9, lineHeight:1.4 }}>
              This will <b>deduct</b> points from DRIP (Discord) and <b>credit</b> the same amount into the game.
            </div>
            <div style={{ marginTop:12, fontSize:13, opacity:0.95 }}>
              DRIP Balance: <b>{typeof dripBalance === 'number' ? dripBalance : '—'}</b>
            </div>
            <div style={{ marginTop:12, display:'grid', gap:8 }}>
              <label style={{ fontSize:12, opacity:0.9 }}>Amount to migrate</label>
              <input value={dripAmount === 0 ? '' : String(dripAmount)}
                onChange={(e) => { const raw = String(e.target.value||'').replace(/^0+/,''); const n=parseInt(raw,10); setDripAmount(isNaN(n)?0:Math.max(0,Math.min(n,typeof dripBalance==='number'?dripBalance:0))); }}
                type="number" min={0} max={typeof dripBalance==='number'?dripBalance:0} placeholder="0"
                style={{ padding:10, borderRadius:10, border:'1px solid rgba(255,255,255,.18)', background:'rgba(15,23,42,.55)', color:'inherit', fontSize:15, width:160 }} />
            </div>
            <div style={{ marginTop:14, display:'flex', gap:8 }}>
              <button className="btn" onClick={migrateDripNow} disabled={dripBusy||dripAmount<=0} style={{ padding:'10px 18px', fontSize:13 }}>
                {dripBusy ? 'Migrating…' : `Migrate ${dripAmount} ${pointsConfig.currency}`}
              </button>
            </div>
            {dripStatus && <div style={{ marginTop:10, fontSize:13 }}>{dripStatus}</div>}
          </div>
        </div>
      )}

      {/* ── STYLES ── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@300;400;700;900&display=swap');
        * { box-sizing: border-box; }
        body { background: #060412; }

        .btn {
          border-radius: 12px;
          border: 1px solid rgba(167,139,250,0.25);
          background: rgba(109,40,217,0.15);
          color: white;
          font-weight: 800;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn:hover { background: rgba(109,40,217,0.3); border-color: rgba(167,139,250,0.5); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .ant-colony-bg { display: none; }
        .page-head { display: none; }

        .rail { position: absolute; left: 0; right: 0; height: 3px; z-index: 4; border-radius: 2px; }
        .rail-top { top: 50%; background: linear-gradient(90deg, transparent, rgba(167,139,250,0.4), transparent); }
        .rail-bottom { top: 72%; background: linear-gradient(90deg, transparent, rgba(167,139,250,0.2), transparent); }

        .scene-bg { position:absolute; inset:0; z-index:0; pointer-events:none; border-radius:20px;
          background-position:center; background-size:cover; background-repeat:no-repeat; }

        .strip { display: none; }
        .ant-scene { border-radius: 20px; }
        .ant-card { background: transparent !important; border: none !important; box-shadow: none !important; }
        .ra-shuffle2 { padding: 0 !important; }

        .egg-card {
          position: absolute;
          transform: translateX(-50%);
          background: transparent;
          border: none;
          padding: 0;
          cursor: pointer;
          transition: transform 0.3s ease, filter 0.3s ease;
          z-index: 6;
        }
        .egg-card:disabled { cursor: not-allowed; }
        .egg-card.can-pick:hover { transform: translateX(-50%) translateY(-12px) scale(1.12) rotateX(-8deg); }

        .egg-body {
          width: 60px; height: 76px;
          border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
          background:
            radial-gradient(ellipse at 30% 28%, rgba(255,255,220,0.9) 0%, transparent 30%),
            radial-gradient(ellipse at 65% 15%, rgba(255,255,200,0.5) 0%, transparent 20%),
            radial-gradient(ellipse at 40% 55%, #fbbf24 0%, #d97706 45%, #b45309 70%, #78350f 100%);
          box-shadow:
            inset -6px -8px 20px rgba(0,0,0,0.4),
            inset 4px 4px 12px rgba(255,255,200,0.3),
            0 8px 24px rgba(0,0,0,0.5),
            0 0 0 1px rgba(251,191,36,0.2);
          transition: background 0.3s, box-shadow 0.3s, transform 0.2s;
          position: relative;
        }
        .egg-shadow {
          width: 56px; height: 14px;
          background: radial-gradient(ellipse, rgba(0,0,0,0.55) 0%, transparent 65%);
          margin: 6px auto 0;
          border-radius: 50%;
          filter: blur(2px);
        }
        .egg-speckle {
          position: absolute; inset: 0;
          border-radius: inherit;
          background:
            radial-gradient(circle at 28% 22%, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.2) 18%, transparent 30%),
            radial-gradient(circle at 62% 14%, rgba(255,255,255,0.3) 0%, transparent 15%),
            radial-gradient(ellipse at 45% 85%, rgba(120,53,15,0.4) 0%, transparent 40%);
          pointer-events: none;
        }
        @keyframes wobble-on-pick {
          0%,100% { transform: rotate(-3deg); }
          50% { transform: rotate(3deg); }
        }
        .wobble-on-pick { animation: wobble-on-pick 0.7s ease-in-out infinite; }

        .ant-progress { position: absolute; bottom: 8px; left: 10px; right: 10px; z-index: 5; }

        @keyframes shuffleFloat {
          0% { transform: translateY(0) scale(1); opacity: inherit; }
          80% { opacity: inherit; }
          100% { transform: translateY(-100vh) scale(0.2); opacity: 0; }
        }
        @keyframes btnGlow {
          0%,100% { box-shadow: 0 0 20px rgba(109,40,217,0.5), 0 0 40px rgba(109,40,217,0.2); }
          50% { box-shadow: 0 0 30px rgba(109,40,217,0.8), 0 0 60px rgba(109,40,217,0.3); }
        }
        @keyframes queenAura {
          0% { opacity:0.6; transform:translateX(-50%) scale(1); }
          100% { opacity:1; transform:translateX(-50%) scale(1.15); }
        }
        @keyframes queenAuraActive {
          0% { opacity:0.8; transform:translateX(-50%) scale(1.1); background: radial-gradient(ellipse, rgba(167,139,250,0.4) 0%, rgba(109,40,217,0.2) 40%, transparent 70%); }
          100% { opacity:1; transform:translateX(-50%) scale(1.35); background: radial-gradient(ellipse, rgba(250,204,21,0.3) 0%, rgba(167,139,250,0.2) 40%, transparent 70%); }
        }
        @keyframes shuffleFlash {
          0% { opacity:0; }
          100% { opacity:1; }
        }
        @keyframes pickPulse {
          0%,100% { opacity:0.7; transform:translateX(-50%) scale(1); }
          50% { opacity:1; transform:translateX(-50%) scale(1.05); letter-spacing:0.3em; }
        }
        @keyframes claimPulse {
          0%,100% { transform:scale(1); opacity:0.9; }
          50% { transform:scale(1.03); opacity:1; }
        }
        .rules-row, .rules-link { display: none; }
      `}</style>
    </>
  );
}
