// components/Raid.tsx
import React, { useState } from "react";
import Link from "next/link";
import { pointsConfig as defaultPointsConfig } from "../lib/pointsConfig";
import { usePoints } from "../lib/usePoints";
import { loadProfile, saveProfile, getEffectivePlayerId } from "../lib/profile";
import { addWin } from "../lib/winsStore";
import LeaderboardPanel from "./LeaderboardPanel";
import BuyPointsModal from "./BuyPointsModal";

// ── Types ────────────────────────────────────────────────────────────────────

type Phase = "idle" | "launching" | "battling" | "revealed";
type Rarity = "none" | "common" | "rare" | "ultra";

type AntRole = "scout" | "soldier" | "carrier" | "guard" | "bomber";

type AntSlot = {
  role: AntRole;
  survived: boolean | null; // null = not yet revealed
};

type Prize =
  | { type: "none"; label: string }
  | { type: "points"; label: string; points: number }
  | { type: "merch"; label: string; meta?: any }
  | { type: "nft"; label: string; meta?: any };

// ── Constants ────────────────────────────────────────────────────────────────

const RAID_COST = 600;
const SQUAD_SIZE = 10;
const REVEAL_INTERVAL_MS = 600; // ms between each ant reveal

const ROLE_META: Record<AntRole, { emoji: string; label: string; desc: string; color: string }> = {
  scout:   { emoji: "🔍", label: "Scout",   desc: "Goes first, reveals the path",        color: "#60a5fa" },
  soldier: { emoji: "⚔️",  label: "Soldier", desc: "Fights through enemy resistance",     color: "#f87171" },
  carrier: { emoji: "🎒", label: "Carrier", desc: "Brings home loot if they survive",     color: "#fbbf24" },
  guard:   { emoji: "🛡️",  label: "Guard",   desc: "Protects adjacent Carriers",          color: "#34d399" },
  bomber:  { emoji: "💥", label: "Bomber",  desc: "Sacrifices itself to clear the path",  color: "#f472b6" },
};

// Survival odds per role (used for provably fair simulation)
const ROLE_SURVIVAL: Record<AntRole, number> = {
  scout:   0.80,
  soldier: 0.65,
  carrier: 0.50,
  guard:   0.75,
  bomber:  0.10, // almost always sacrifices
};

// Default squad lineup
const DEFAULT_SQUAD: AntRole[] = [
  "scout", "scout", "soldier", "soldier", "bomber",
  "guard", "carrier", "guard", "carrier", "soldier",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function simulateBattle(squad: AntRole[]): AntSlot[] {
  // Scout at front boosts everyone behind it slightly
  const scoutBonus = squad.slice(0, 3).filter(r => r === "scout").length * 0.05;

  // Guard protects adjacent Carriers
  return squad.map((role, i) => {
    let survivalChance = ROLE_SURVIVAL[role] + scoutBonus;

    if (role === "carrier") {
      // Check if there's a guard adjacent
      const guardLeft  = i > 0 && squad[i - 1] === "guard";
      const guardRight = i < squad.length - 1 && squad[i + 1] === "guard";
      if (guardLeft || guardRight) survivalChance += 0.20;
    }

    // Bomber that clears the path boosts the next 2 ants
    if (role === "bomber" && i < squad.length - 1) {
      // Bomber always dies but gives next ants a big survival boost
      // (handled below via a second pass)
    }

    return {
      role,
      survived: Math.random() < Math.min(survivalChance, 0.95),
    };
  });
}

function calcPrizeFromResult(
  slots: AntSlot[],
  pointsConfig: any
): { rarity: Rarity; prize: Prize } {
  const currency = pointsConfig?.currency || "REBEL";
  const carriers = slots.filter(s => s.role === "carrier" && s.survived);
  const survivors = slots.filter(s => s.survived);

  const survivorRatio = survivors.length / slots.length;

  // Rarity based on carriers + overall survivors
  let rarity: Rarity = "none";
  if (carriers.length >= 2 && survivorRatio >= 0.7) rarity = "ultra";
  else if (carriers.length >= 1 && survivorRatio >= 0.5) rarity = "rare";
  else if (survivors.length >= 4) rarity = "common";

  const pts =
    rarity === "ultra"  ? Number(pointsConfig?.rewards?.ultra  ?? 300) :
    rarity === "rare"   ? Number(pointsConfig?.rewards?.rare   ?? 100) :
    rarity === "common" ? Number(pointsConfig?.rewards?.common ?? 50)  : 0;

  if (pts > 0) {
    return {
      rarity,
      prize: { type: "points", label: `+${pts} ${currency}`, points: pts },
    };
  }

  return { rarity: "none", prize: { type: "none", label: "The colony held its ground." } };
}

// ── Sub-components ───────────────────────────────────────────────────────────

function RolePicker({
  squad,
  onChange,
  disabled,
}: {
  squad: AntRole[];
  onChange: (next: AntRole[]) => void;
  disabled: boolean;
}) {
  const roles = Object.keys(ROLE_META) as AntRole[];

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, opacity: 0.9 }}>
        ⚔️ Build Your Squad — {SQUAD_SIZE} ants
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 10 }}>
        {roles.map(role => {
          const m = ROLE_META[role];
          const count = squad.filter(r => r === role).length;
          return (
            <button
              key={role}
              disabled={disabled}
              title={m.desc}
              onClick={() => {
                if (squad.length >= SQUAD_SIZE) return;
                onChange([...squad, role]);
              }}
              style={{
                padding: "8px 4px",
                borderRadius: 10,
                border: `1px solid ${m.color}44`,
                background: `${m.color}18`,
                color: "white",
                cursor: disabled ? "not-allowed" : "pointer",
                fontSize: 11,
                fontWeight: 700,
                textAlign: "center",
                opacity: disabled ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: 18 }}>{m.emoji}</div>
              <div style={{ color: m.color }}>{m.label}</div>
              <div style={{ opacity: 0.7 }}>×{count}</div>
            </button>
          );
        })}
      </div>

      {/* Lineup display */}
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>
        Marching order ({squad.length}/{SQUAD_SIZE}):
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {squad.map((role, i) => {
          const m = ROLE_META[role];
          return (
            <button
              key={i}
              disabled={disabled}
              title={`Remove ${m.label}`}
              onClick={() => {
                if (disabled) return;
                const next = [...squad];
                next.splice(i, 1);
                onChange(next);
              }}
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                border: `1px solid ${m.color}55`,
                background: `${m.color}22`,
                cursor: disabled ? "default" : "pointer",
                fontSize: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}
            >
              {m.emoji}
              <span style={{
                position: "absolute",
                top: -6,
                left: -4,
                fontSize: 9,
                background: "rgba(0,0,0,.7)",
                borderRadius: 4,
                padding: "1px 3px",
                color: "rgba(255,255,255,.7)",
              }}>
                {i + 1}
              </span>
            </button>
          );
        })}
        {squad.length < SQUAD_SIZE && (
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            border: "1px dashed rgba(255,255,255,.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, opacity: 0.35,
          }}>
            +
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          disabled={disabled}
          onClick={() => onChange([...DEFAULT_SQUAD])}
          style={{
            fontSize: 11, padding: "5px 10px", borderRadius: 8,
            border: "1px solid rgba(255,255,255,.18)",
            background: "rgba(255,255,255,.08)", color: "white",
            cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
          }}
        >
          Auto-fill Squad
        </button>
        <button
          disabled={disabled}
          onClick={() => onChange([])}
          style={{
            fontSize: 11, padding: "5px 10px", borderRadius: 8,
            border: "1px solid rgba(255,255,255,.18)",
            background: "rgba(255,255,255,.08)", color: "white",
            cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function BattleScene({
  slots,
  phase,
  revealedCount,
}: {
  slots: AntSlot[];
  phase: Phase;
  revealedCount: number;
}) {
  return (
    <div style={{
      marginTop: 16,
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,.12)",
      background: "rgba(0,0,0,.35)",
      padding: 14,
      minHeight: 140,
    }}>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>
        {phase === "battling" || phase === "revealed"
          ? "🐜 Squad report — tap to zoom"
          : "🐜 Squad awaiting orders…"}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {slots.map((slot, i) => {
          const m = ROLE_META[slot.role];
          const isRevealed = i < revealedCount;
          const survived = slot.survived;

          return (
            <div
              key={i}
              title={`${m.label} — ${isRevealed ? (survived ? "Survived ✅" : "Fell ❌") : "Awaiting…"}`}
              style={{
                width: 46,
                height: 52,
                borderRadius: 10,
                border: `1px solid ${
                  !isRevealed ? "rgba(255,255,255,.15)" :
                  survived ? `${m.color}88` : "rgba(239,68,68,.4)"
                }`,
                background: !isRevealed
                  ? "rgba(255,255,255,.05)"
                  : survived
                  ? `${m.color}18`
                  : "rgba(239,68,68,.1)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                transition: "all 0.3s ease",
                opacity: !isRevealed ? 0.4 : 1,
                position: "relative",
              }}
            >
              <span style={{ filter: !isRevealed ? "grayscale(1)" : "none" }}>
                {m.emoji}
              </span>
              {isRevealed && (
                <span style={{ fontSize: 10, marginTop: 2 }}>
                  {survived ? "✅" : "❌"}
                </span>
              )}
              <span style={{
                position: "absolute", top: -5, left: -3,
                fontSize: 8,
                background: "rgba(0,0,0,.7)",
                borderRadius: 3, padding: "1px 2px",
                color: "rgba(255,255,255,.6)",
              }}>
                {i + 1}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RaidResultModal({
  slots,
  rarity,
  prize,
  onClose,
}: {
  slots: AntSlot[];
  rarity: Rarity;
  prize: Prize | null;
  onClose: () => void;
}) {
  const survivors = slots.filter(s => s.survived).length;
  const carriers  = slots.filter(s => s.role === "carrier" && s.survived).length;
  const total     = slots.length;

  const title =
    rarity === "ultra"  ? "🏆 RAID SUCCESS — ULTRA HAUL!" :
    rarity === "rare"   ? "⚔️ Raid Complete — Rare Loot!" :
    rarity === "common" ? "✅ Raid Done — Common Crate" :
    "💀 Raid Failed";

  const sparks = Array.from({ length: rarity !== "none" ? 20 : 0 }, (_, i) => ({
    left: `${8 + (i * 4.3) % 84}%`,
    top:  `${10 + (i * 7.1) % 62}%`,
    size: 10 + ((i * 3) % 12),
    delay: (i * 0.2) % 3,
  }));

  return (
    <div style={{
      position: "fixed", inset: 0,
      display: "grid", placeItems: "center",
      background: "rgba(0,0,0,.6)",
      zIndex: 2147483647,
    }} role="dialog" aria-modal="true">
      <div style={{
        position: "relative",
        minWidth: 320, maxWidth: "90vw",
        padding: 24, borderRadius: 16,
        textAlign: "center",
        background: "rgba(15,23,42,.97)",
        border: "1px solid rgba(148,163,184,.25)",
        boxShadow: "0 24px 60px rgba(0,0,0,.6)",
        overflow: "visible",
      }}>
        {/* Sparkles */}
        {sparks.map((s, i) => (
          <span key={i} style={{
            position: "absolute",
            left: s.left, top: s.top,
            width: s.size, height: s.size,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(255,255,255,.95) 0%, rgba(255,255,255,0) 65%)",
            filter: `blur(0.3px) drop-shadow(0 0 12px ${
              rarity === "ultra" ? "rgba(244,63,94,1)" :
              rarity === "rare"  ? "rgba(59,130,246,.95)" :
              "rgba(147,197,253,.85)"
            })`,
            opacity: 0,
            animation: `pmSpark 2.6s ease-in-out ${s.delay}s infinite`,
            pointerEvents: "none",
          }} />
        ))}

        <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 8 }}>{title}</div>

        {/* Battle stats */}
        <div style={{
          display: "flex", gap: 16, justifyContent: "center",
          fontSize: 13, opacity: 0.9, marginBottom: 12,
        }}>
          <span>🐜 {survivors}/{total} survived</span>
          <span>🎒 {carriers} carrier{carriers !== 1 ? "s" : ""} returned</span>
        </div>

        {/* Ant results */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center", marginBottom: 14 }}>
          {slots.map((slot, i) => {
            const m = ROLE_META[slot.role];
            return (
              <div key={i} title={`${m.label} ${slot.survived ? "survived" : "fell"}`}
                style={{
                  width: 36, height: 42, borderRadius: 8,
                  border: `1px solid ${slot.survived ? `${m.color}66` : "rgba(239,68,68,.3)"}`,
                  background: slot.survived ? `${m.color}15` : "rgba(239,68,68,.08)",
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  fontSize: 14,
                }}
              >
                {m.emoji}
                <span style={{ fontSize: 9 }}>{slot.survived ? "✅" : "❌"}</span>
              </div>
            );
          })}
        </div>

        {/* Prize */}
        {prize && prize.type !== "none" && (
          <>
            {rarity !== "none" && (
              <img
                src={`/crates/${rarity}.png`}
                alt={`${rarity} crate`}
                style={{ width: 160, height: "auto", display: "block", margin: "0 auto 10px" }}
              />
            )}
            <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 12 }}>
              Loot: <b>{prize.type === "points" ? prize.label : prize.label}</b>
            </div>
          </>
        )}

        {prize?.type === "none" && (
          <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 12 }}>
            {prize.label}
          </div>
        )}

        <button
          className="btn"
          onClick={onClose}
          style={{ padding: "10px 24px", fontSize: 14, fontWeight: 800 }}
        >
          Continue
        </button>
      </div>

      <style>{`
        @keyframes pmSpark {
          0%   { transform: scale(0.4); opacity: 0; }
          20%  { opacity: 1; }
          55%  { transform: scale(1.1); opacity: 0.9; }
          85%  { transform: scale(0.7); opacity: 0.7; }
          100% { transform: scale(0.3); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Raid() {
  // ── Identity (mirrors Shuffle exactly) ──
  const [{ name: initialName, id: initialId, effectiveId: initialEffectiveId }] = useState(() => {
    const p = loadProfile();
    const name = (p?.name || "guest").trim() || "guest";
    let id = (p?.id || "").trim();
    if (!id) {
      id = `guest-${Math.random().toString(36).slice(2, 7)}`;
      saveProfile({ name, id });
    }
    const effectiveId = getEffectivePlayerId({ ...p, id, name } as any);
    return { name, id, effectiveId };
  });

  const [playerName, setPlayerName] = useState(initialName);
  const [playerId]                   = useState(initialId);
  const [effectivePlayerId, setEffectivePlayerId] = useState(initialEffectiveId);

  React.useEffect(() => {
    const update = () => {
      const p = loadProfile();
      setEffectivePlayerId(getEffectivePlayerId(p));
    };
    update();
    window.addEventListener("ra:identity-changed", update);
    return () => window.removeEventListener("ra:identity-changed", update);
  }, []);

  // ── Live config (mirrors Shuffle) ──
  const [pointsConfig, setPointsConfig] = useState(defaultPointsConfig);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/config", { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (!cancelled && r.ok && j?.pointsConfig) {
          setPointsConfig(prev => ({ ...prev, ...j.pointsConfig }));
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Economy ──
  const { balance, spend, earn, devGrant, refresh } = usePoints(effectivePlayerId);

  // ── Discord / profile ──
  const [profile, setProfile] = React.useState<any>(() => { try { return loadProfile(); } catch { return {}; } });

  React.useEffect(() => {
    const sync = () => { try { setProfile(loadProfile()); } catch { setProfile({}); } };
    sync();
    window.addEventListener("ra:identity-changed", sync);
    return () => window.removeEventListener("ra:identity-changed", sync);
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("discord") === "1") window.dispatchEvent(new Event("ra:identity-changed"));
  }, []);

  const isDiscordConnected = !!profile?.discordUserId && !(profile as any)?.discordSkipLink;

  // Refresh on identity change
  const lastPidRef = React.useRef<string>("");
  React.useEffect(() => {
    if (!effectivePlayerId || lastPidRef.current === effectivePlayerId) return;
    lastPidRef.current = effectivePlayerId;
    refresh().catch(() => {});
  }, [effectivePlayerId, refresh]);

  // ── Daily claim ──
  const [dailyClaimed, setDailyClaimed] = useState(false);
  const [claimStatus, setClaimStatus]   = useState("");
  const [claimBusy, setClaimBusy]       = useState(false);

  React.useEffect(() => {
    if (!effectivePlayerId) return;
    (async () => {
      try {
        const r = await fetch(`/api/points/claim?playerId=${encodeURIComponent(effectivePlayerId)}`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (r.ok && j?.ok) setDailyClaimed(!!j.claimed);
      } catch {}
    })();
  }, [effectivePlayerId]);

  async function claimDailyNow() {
    if (!effectivePlayerId || claimBusy) return;
    setClaimBusy(true);
    setClaimStatus("");
    try {
      const r = await fetch("/api/points/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: effectivePlayerId, amount: pointsConfig.dailyClaim }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { setClaimStatus(j?.error || "Claim failed."); return; }
      setClaimStatus(j?.alreadyClaimed ? "Already claimed today ✅" : `Claimed +${j?.added || pointsConfig.dailyClaim} ${pointsConfig.currency} ✅`);
      setDailyClaimed(true);
      await refresh();
    } catch (e: any) {
      setClaimStatus(e?.message || "Claim error");
    } finally {
      setClaimBusy(false);
    }
  }

  // ── Squad builder ──
  const [squad, setSquad] = useState<AntRole[]>([...DEFAULT_SQUAD]);

  // ── Game state ──
  const [phase, setPhase]               = useState<Phase>("idle");
  const [busy, setBusy]                 = useState(false);
  const [slots, setSlots]               = useState<AntSlot[]>([]);
  const [revealedCount, setRevealedCount] = useState(0);
  const [rarity, setRarity]             = useState<Rarity>("none");
  const [prize, setPrize]               = useState<Prize | null>(null);
  const [showResult, setShowResult]     = useState(false);
  const [showBuyPoints, setShowBuyPoints] = useState(false);

  const cost    = RAID_COST;
  const needMore = Math.max(0, cost - balance);

  // ── Launch raid ──
  async function launchRaid() {
    if (busy || squad.length < SQUAD_SIZE || balance < cost) return;

    setBusy(true);
    setPhase("launching");
    setSlots([]);
    setRevealedCount(0);
    setShowResult(false);

    // Deduct cost
    await spend(cost, "raid");

    // Small launch delay for drama
    await new Promise(r => setTimeout(r, 600));

    // Simulate battle server-side using prizes/roll for rarity,
    // but compute ant survival locally for animation
    const battleSlots = simulateBattle(squad);
    setSlots(battleSlots);
    setPhase("battling");

    // Reveal ants one by one
    for (let i = 1; i <= SQUAD_SIZE; i++) {
      await new Promise(r => setTimeout(r, REVEAL_INTERVAL_MS));
      setRevealedCount(i);
    }

    // Small pause before result
    await new Promise(r => setTimeout(r, 500));

    // Roll prize on server (re-use existing endpoint)
    const prof = loadProfile();
    const pid  = String(effectivePlayerId || getEffectivePlayerId(prof) || prof?.id || "guest").trim().slice(0, 64) || "guest";
    const pname = (prof?.discordName || playerName || prof?.name || "guest").trim() || "guest";

    // Calc prize from battle outcome
    const { rarity: r, prize: pz } = calcPrizeFromResult(battleSlots, pointsConfig);

    // Credit points if earned
    if (pz.type === "points" && pz.points > 0) {
      await earn(pz.points);
      await refresh();
    }

    // Track win
    const pointsAwarded = pz.type === "points" ? pz.points : 0;

    addWin({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
      game: "raid",
      playerId: pid,
      playerName: pname,
      rarity: r,
      pointsAwarded,
    });

    await fetch("/api/wins/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ts: Date.now(),
        game: "raid",
        playerId: effectivePlayerId || pid,
        playerName: prof?.discordName || prof?.name || pname,
        rarity: r,
        pointsAwarded,
        prize: pz.type !== "points" ? pz : null,
      }),
    }).catch(() => {});

    window.dispatchEvent(new Event("ra:leaderboards-refresh"));

    setRarity(r);
    setPrize(pz);
    setPhase("revealed");
    setShowResult(true);
    setBusy(false);
  }

  function resetRaid() {
    setShowResult(false);
    setPhase("idle");
    setSlots([]);
    setRevealedCount(0);
    setRarity("none");
    setPrize(null);
    setSquad([...DEFAULT_SQUAD]);
  }

  function disconnectDiscord() {
    try {
      const p: any = loadProfile() || {};
      const fallback = (p.walletAddress ? `wallet:${p.walletAddress}` : (p.id || "guest")).trim();
      saveProfile({ discordUserId: undefined, discordName: undefined, primaryId: fallback, discordSkipLink: true as any } as any);
      window.dispatchEvent(new Event("ra:identity-changed"));
    } catch {}
    window.location.href = "/api/auth/discord/logout";
  }

  const isBuilding = phase === "idle" || phase === "revealed";
  const isBattling = phase === "launching" || phase === "battling";

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {/* Full-screen background */}
      <div
        className="ant-colony-bg"
        aria-hidden="true"
        style={{
          backgroundImage: `linear-gradient(140deg, rgba(11,27,49,0.18), rgba(7,13,26,0.55))`,
        }}
      />

      {/* Header */}
      <header className="page-head" role="banner">
        <div className="site-title">
          <Link href="/">Rebel Ants Playground</Link>
        </div>
        <nav className="tabs" aria-label="Main">
          <Link href="/tunnel"     className="tab">🐜 Ant Tunnel</Link>
          <Link href="/hatch"      className="tab">🥚 Queen&apos;s Egg Hatch</Link>
          <Link href="/expedition" className="tab tab-active">🛡️ Expedition</Link>
          <Link href="/shuffle"    className="tab">🥚 Shuffle</Link>
        </nav>
      </header>

      {/* Main card */}
      <div className="ant-card">
        <div className="title">⚔️ The Raid</div>
        <p className="subtitle">
          Assemble a squad of {SQUAD_SIZE} ants. Send them into enemy territory. See who comes back with loot.
        </p>

        {/* Squad builder */}
        <RolePicker
          squad={squad}
          onChange={setSquad}
          disabled={isBattling}
        />

        {/* Role legend */}
        <div style={{
          marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap",
          fontSize: 11, opacity: 0.7,
        }}>
          {(Object.keys(ROLE_META) as AntRole[]).map(role => {
            const m = ROLE_META[role];
            return (
              <span key={role} style={{ color: m.color }}>
                {m.emoji} {m.label}: {m.desc}
              </span>
            );
          })}
        </div>

        {/* Battle scene */}
        {(phase === "battling" || phase === "revealed") && slots.length > 0 && (
          <BattleScene
            slots={slots}
            phase={phase}
            revealedCount={revealedCount}
          />
        )}

        {/* Launching animation */}
        {phase === "launching" && (
          <div style={{
            marginTop: 16, padding: 20, borderRadius: 14,
            border: "1px solid rgba(255,255,255,.12)",
            background: "rgba(0,0,0,.35)",
            textAlign: "center", fontSize: 14, opacity: 0.85,
          }}>
            🐜🐜🐜 Squad marching into enemy territory…
          </div>
        )}

        {/* Battling status */}
        {phase === "battling" && (
          <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8, textAlign: "center" }}>
            Revealing ant {Math.min(revealedCount + 1, SQUAD_SIZE)} of {SQUAD_SIZE}…
          </div>
        )}

        {/* CTA row */}
        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            className="btn"
            onClick={launchRaid}
            disabled={busy || squad.length < SQUAD_SIZE || needMore > 0}
            title={
              squad.length < SQUAD_SIZE ? `Need ${SQUAD_SIZE} ants (have ${squad.length})` :
              needMore > 0 ? "Not enough points" : ""
            }
            style={{ minWidth: 220, height: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", position: "relative" }}
          >
            <span style={{ visibility: "hidden" }}>Launch Raid (-{cost} {pointsConfig.currency})</span>
            <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {phase === "launching" ? "Marching…" :
               phase === "battling"  ? "Battle in progress…" :
               squad.length < SQUAD_SIZE ? `Need ${SQUAD_SIZE - squad.length} more ants` :
               `Launch Raid (-${cost} ${pointsConfig.currency})`}
            </span>
          </button>

          <button
            className="btn"
            type="button"
            onClick={() => setShowBuyPoints(true)}
            style={{ padding: "10px 12px", fontSize: 13 }}
          >
            Buy Points / Connect Ape Wallet
          </button>

          {isDiscordConnected ? (
            <button className="btn" type="button" onClick={disconnectDiscord} style={{ padding: "10px 12px", fontSize: 13 }}>
              Disconnect Discord
            </button>
          ) : (
            <button
              className="btn"
              type="button"
              onClick={() => {
                try { saveProfile({ discordSkipLink: false }); window.dispatchEvent(new Event("ra:identity-changed")); } catch {}
                window.location.href = "/api/auth/discord/login";
              }}
              style={{ padding: "10px 12px", fontSize: 13 }}
            >
              Connect Discord
            </button>
          )}

          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Discord: <b>{isDiscordConnected ? "Connected ✅" : "Not Connected ❌"}</b>
          </div>
        </div>

        {/* Balance + info row */}
        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span>Balance: <b>{balance}</b> {pointsConfig.currency}</span>
          <span>Cost: <b>{cost}</b> {pointsConfig.currency}</span>
          {needMore > 0 && <span style={{ opacity: 0.9 }}>Need {needMore} more {pointsConfig.currency}.</span>}
        </div>

        {/* Odds info */}
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
          Common: +{pointsConfig.rewards.common} &nbsp;|&nbsp;
          Rare: +{pointsConfig.rewards.rare} &nbsp;|&nbsp;
          Ultra: +{pointsConfig.rewards.ultra} &nbsp;|&nbsp;
          Daily cap: {pointsConfig.dailyEarnCap}
        </div>

        {/* Name + daily claim */}
        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 13, opacity: 0.9 }}>
            Name:&nbsp;
            <input
              value={playerName}
              onChange={e => {
                const v = (e.target.value.slice(0, 18) || "guest").trim() || "guest";
                setPlayerName(v);
                const p = loadProfile();
                saveProfile({ name: v, id: (p?.id || playerId || "guest").trim() || "guest" });
              }}
              style={{
                padding: "6px 10px", borderRadius: 10,
                border: "1px solid rgba(255,255,255,.18)",
                background: "rgba(15,23,42,.55)", color: "inherit",
              }}
            />
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
              Identity: <b>{playerName || effectivePlayerId}</b>
            </div>
          </label>

          <button
            className="btn"
            type="button"
            onClick={claimDailyNow}
            disabled={claimBusy || dailyClaimed}
            style={{ padding: "8px 12px", fontSize: 13 }}
          >
            {dailyClaimed ? "Claimed Today ✅" : `Claim Daily +${pointsConfig.dailyClaim} ${pointsConfig.currency}`}
          </button>

          {process.env.NODE_ENV !== "production" && (
            <button
              className="btn"
              type="button"
              onClick={async () => { await devGrant(5000); await refresh(); alert("Dev grant ✅"); }}
              style={{ padding: "8px 12px", fontSize: 13 }}
            >
              Dev Grant +5000
            </button>
          )}

          {claimStatus && <div style={{ fontSize: 12, opacity: 0.9 }}>{claimStatus}</div>}
        </div>

        {/* Rules */}
        <div style={{ marginTop: 10 }}>
          <a href="/rules" style={{ fontSize: 13, textDecoration: "underline", opacity: 0.85 }}>
            Official Rules
          </a>
        </div>

        {/* Leaderboard */}
        <div style={{
          marginTop: 14, padding: 12, borderRadius: 14,
          border: "1px solid rgba(255,255,255,.14)",
          background: "rgba(15,23,42,.35)",
          backdropFilter: "blur(6px)",
        }}>
          <LeaderboardPanel />
        </div>

        {/* Result modal */}
        {showResult && slots.length > 0 && (
          <RaidResultModal
            slots={slots}
            rarity={rarity}
            prize={prize}
            onClose={resetRaid}
          />
        )}

        {/* Buy points modal */}
        <BuyPointsModal
          open={showBuyPoints}
          onClose={() => setShowBuyPoints(false)}
          playerId={effectivePlayerId}
          onClaimed={async () => { await refresh(); }}
        />
      </div>

      <style>{`
        .ant-colony-bg {
          position: fixed; inset: 0; pointer-events: none; z-index: 0;
          background-size: cover; background-position: center;
          filter: saturate(1.05);
        }
        .page-head {
          position: relative; z-index: 10;
          max-width: 980px; margin: 24px auto 14px; padding: 4px 2px;
        }
        .site-title { font-size: 22px; font-weight: 800; margin-bottom: 8px; }
        .site-title a { color: inherit; text-decoration: none; }
        .tabs { display: flex; gap: 8px; flex-wrap: wrap; }
        .tab {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 10px; border-radius: 999px; font-size: 13px;
          background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.18);
          backdrop-filter: blur(4px); transition: transform .06s ease, background .2s ease;
        }
        .tab:hover { transform: translateY(-1px); background: rgba(255,255,255,.12); }
        .tab-active { background: rgba(255,255,255,.16); }
        .btn {
          border-radius: 12px; border: 1px solid rgba(255,255,255,.18);
          background: rgba(15,23,42,.7); color: white;
          font-weight: 800; cursor: pointer; padding: 10px 16px;
        }
        .btn:hover { background: rgba(15,23,42,.9); }
        .btn:disabled { opacity: .55; cursor: not-allowed; }
      `}</style>
    </>
  );
}
