import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Head from "next/head";
import { loadProfile, type Profile } from "../../lib/profile";
import type { PvpMatch, PvpStatus } from "../../lib/types/fwpvp";

const JP = `'Noto Serif JP', 'Hiragino Mincho ProN', serif`;

// ── Identity helper ──────────────────────────────────────────────────────────
// PvP requires a stable identity. We accept (in priority order):
//   1. profile.primaryId  (e.g. "discord:123" or "wallet:0xabc")
//   2. "commander:{name}" if the player has claimed a commander name (name !== "guest")
// Otherwise: blocked, show sign-in prompt.
function deriveIdentity(p: Profile | null): { playerId: string; displayName: string } | null {
  if (!p) return null;
  if (p.primaryId) {
    return {
      playerId: p.primaryId,
      displayName: p.discordName || p.name || "Anonymous",
    };
  }
  if (p.name && p.name !== "guest" && p.name.trim().length > 0) {
    return {
      playerId: `commander:${p.name}`,
      displayName: p.name,
    };
  }
  return null;
}

// ── Status pill rendering ────────────────────────────────────────────────────
function statusPill(status: PvpStatus, isMyTurn: boolean): { label: string; color: string; bg: string; border: string } {
  if (status === "completed") return { label: "Completed", color: "rgba(255,255,255,0.55)", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)" };
  if (status === "cancelled") return { label: "Cancelled", color: "rgba(255,255,255,0.4)", bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.08)" };
  if (status === "pending") return { label: "Awaiting opponent", color: "#a5b4fc", bg: "rgba(88,101,242,0.08)", border: "rgba(88,101,242,0.3)" };
  if (status === "team_selection") return { label: "Team selection", color: "#fbbf24", bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.35)" };
  if (status === "active" && isMyTurn) return { label: "⚔️ Your turn", color: "#fbbf24", bg: "rgba(251,191,36,0.18)", border: "rgba(251,191,36,0.55)" };
  return { label: "Waiting…", color: "rgba(255,255,255,0.5)", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)" };
}

// ── Match card ───────────────────────────────────────────────────────────────
function MatchCard({ match, mePlayerId }: { match: PvpMatch; mePlayerId: string }) {
  const isChallenger = match.challengerPlayerId === mePlayerId;
  const opponentName = isChallenger ? match.opponentDisplayName : match.challengerDisplayName;
  const isMyTurn = match.currentTurnPlayerId === mePlayerId;
  const pill = statusPill(match.status, isMyTurn);

  // For pending challenges I created where opponent hasn't joined yet
  const showShareLink = match.status === "pending" && isChallenger;

  // Result line for completed matches
  let resultLine: string | null = null;
  if (match.status === "completed") {
    if (match.winnerPlayerId === mePlayerId) {
      resultLine = `🏆 You won — ${match.winnerCrateRarity?.toUpperCase() || ""} crate`;
    } else if (match.loserPlayerId === mePlayerId) {
      resultLine = "💀 You lost";
    } else {
      resultLine = "Draw";
    }
  }

  return (
    <Link href={`/faction-wars/challenge/${match.challengeId}`} style={{ textDecoration: "none", color: "inherit" }}>
      <div
        style={{
          padding: "14px 16px",
          borderRadius: 12,
          border: `1px solid ${pill.border}`,
          background: "rgba(255,255,255,0.02)",
          marginBottom: 10,
          cursor: "pointer",
          transition: "all 0.2s",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.05)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.02)"; }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: "0.05em", marginBottom: 4 }}>
              vs <span style={{ color: "#fbbf24" }}>{opponentName || "(awaiting opponent)"}</span>
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              {match.status === "active" || match.status === "completed"
                ? `Territory ${Math.min(match.currentTerritory + 1, 5)} / 5 · ${match.challengerTerritoriesWon}–${match.opponentTerritoriesWon}`
                : ""}
            </div>
            {resultLine && (
              <div style={{ fontSize: 11, marginTop: 4, color: "#fbbf24", fontWeight: 700 }}>{resultLine}</div>
            )}
          </div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 900,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              padding: "5px 10px",
              borderRadius: 12,
              border: `1px solid ${pill.border}`,
              background: pill.bg,
              color: pill.color,
              whiteSpace: "nowrap",
            }}
          >
            {pill.label}
          </div>
        </div>
        {showShareLink && (
          <div style={{ marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>
            🔗 {typeof window !== "undefined" ? window.location.origin : ""}/faction-wars/challenge/{match.challengeId}
          </div>
        )}
      </div>
    </Link>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function PvpLobbyPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [identity, setIdentity] = useState<{ playerId: string; displayName: string } | null>(null);
  const [matches, setMatches] = useState<PvpMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  // ── PvP economy state (Commit C) ──────────────────────────────────────────
  // Pulled from GET /api/config (public endpoint that exposes admin-saved
  // economy config, including factionWarsPvpCost / factionWarsPvpEnabled).
  // Balance comes from GET /api/points/balance?playerId=…
  const [pvpCost, setPvpCost] = useState<number | null>(null);
  const [pvpEnabled, setPvpEnabled] = useState<boolean>(true);
  const [balance, setBalance] = useState<number | null>(null);
  // Variable wager (Layer 2A): tiers come from admin config
  // factionWarsPvpWagerTiers, default [100,300,500,1000,3000,5000,10000].
  // selectedTier defaults to factionWarsPvpCost (typically 300).
  const [pvpTiers, setPvpTiers] = useState<number[]>([100, 300, 500, 1000, 3000, 5000, 10000]);
  const [selectedTier, setSelectedTier] = useState<number | null>(null);

  // Initial profile + identity load
  useEffect(() => {
    const p = loadProfile();
    setProfile(p);
    setIdentity(deriveIdentity(p));
  }, []);

  // Fetch my matches (refresh every 10s)
  const refreshMatches = useCallback(async () => {
    if (!identity) { setLoading(false); return; }
    try {
      const r = await fetch(`/api/faction-wars/pvp/list-mine?playerId=${encodeURIComponent(identity.playerId)}`);
      const j = await r.json();
      if (j.ok) setMatches(j.matches as PvpMatch[]);
    } catch {} finally {
      setLoading(false);
    }
  }, [identity]);

  // Clear all completed/cancelled matches from MY view (other player still sees them).
  const clearCompleted = useCallback(async () => {
    if (!identity) return;
    if (clearBusy) return;
    const ids = matches
      .filter((m) => m.status === "completed" || m.status === "cancelled")
      .map((m) => m.challengeId);
    if (ids.length === 0) return;
    if (typeof window !== "undefined" && !window.confirm(`Clear ${ids.length} completed match${ids.length === 1 ? "" : "es"} from your view? Your opponents will still see them in their history.`)) return;
    setClearBusy(true);
    setClearError(null);
    try {
      const r = await fetch("/api/faction-wars/pvp/hide-completed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: identity.playerId, challengeIds: ids }),
      });
      const j = await r.json();
      if (!j?.ok) {
        setClearError(j?.error || "Failed to clear");
      } else {
        await refreshMatches();
        setShowCompleted(false);
      }
    } catch (e: any) {
      setClearError(e?.message || "Network error");
    } finally {
      setClearBusy(false);
    }
  }, [identity, matches, clearBusy, refreshMatches]);

  useEffect(() => {
    if (!identity) return;
    refreshMatches();
    const t = setInterval(refreshMatches, 10000);
    return () => clearInterval(t);
  }, [identity, refreshMatches]);

  // ── Fetch PvP cost / enabled flag + player balance ──────────────────────
  // Called once when identity is known. We don't bother polling — admin tweaks
  // are infrequent and stale cost just means the create call may reject; UX
  // shows the up-to-date "insufficient funds" error from the API in that case.
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    (async () => {
      try {
        const [cfgRes, balRes] = await Promise.all([
          fetch("/api/config").then(r => r.json()).catch(() => null),
          fetch(`/api/points/balance?playerId=${encodeURIComponent(identity.playerId)}`).then(r => r.json()).catch(() => null),
        ]);
        if (cancelled) return;
        if (cfgRes?.ok && cfgRes.pointsConfig) {
          const cost = Number(cfgRes.pointsConfig.factionWarsPvpCost);
          const enabled = cfgRes.pointsConfig.factionWarsPvpEnabled;
          const resolvedCost = Number.isFinite(cost) && cost >= 0 ? cost : 300;
          setPvpCost(resolvedCost);
          setPvpEnabled(enabled === false ? false : true);
          const rawTiers = cfgRes.pointsConfig.factionWarsPvpWagerTiers;
          const tiers: number[] = Array.isArray(rawTiers)
            ? rawTiers.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n >= 0)
            : [];
          const finalTiers = tiers.length > 0 ? tiers : [100, 300, 500, 1000, 3000, 5000, 10000];
          setPvpTiers(finalTiers);
          // Default selection: highlight the live cost if it's in the tier list,
          // else fall back to the first tier.
          setSelectedTier((prev) => {
            if (prev !== null && finalTiers.includes(prev)) return prev;
            return finalTiers.includes(resolvedCost) ? resolvedCost : finalTiers[0];
          });
        }
        if (balRes?.ok || (balRes && typeof balRes.balance === "number")) {
          setBalance(Number(balRes.balance ?? 0));
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [identity]);

  const handleCreate = async () => {
    if (!identity) return;
    setCreateError(null);
    setCreating(true);
    try {
      const r = await fetch("/api/faction-wars/pvp/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengerPlayerId: identity.playerId,
          challengerDisplayName: identity.displayName,
          wagerAmount: selectedTier ?? undefined,
        }),
      });
      const j = await r.json();
      if (!j.ok) {
        setCreateError(j.error || "Failed to create challenge");
        return;
      }
      // Navigate to the new challenge page where they'll pick their team
      window.location.href = `/faction-wars/challenge/${j.challengeId}`;
    } catch (e: any) {
      setCreateError(e?.message || "Network error");
    } finally {
      setCreating(false);
    }
  };

  const activeMatches = matches.filter((m) => m.status !== "completed" && m.status !== "cancelled");
  const completedMatches = matches.filter((m) => m.status === "completed" || m.status === "cancelled");

  return (
    <>
      <Head>
        <title>Faction Wars PvP — Rebel Ants Playground</title>
      </Head>
      <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#0a0a14 0%,#1a0f1f 100%)", color: "white", paddingBottom: 60 }}>
        {/* Header */}
        <header style={{ position: "relative", zIndex: 20, maxWidth: 980, margin: "0 auto", padding: "16px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: JP }}>
          <Link href="/faction-wars" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "white" }}>
            <span style={{ fontSize: 20, filter: "drop-shadow(0 0 8px rgba(251,191,36,0.6))" }}>←</span>
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>Faction Wars</span>
          </Link>
        </header>

        {/* Content */}
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "12px 16px 40px", fontFamily: JP }}>
          {/* Title */}
          <div style={{ textAlign: "center", marginBottom: 28, marginTop: 14 }}>
            <div style={{
              fontSize: "clamp(22px,4vw,38px)", fontWeight: 900, letterSpacing: "0.15em", textTransform: "uppercase",
              background: "linear-gradient(135deg,#fbbf24,#f87171,#c084fc)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
              filter: "drop-shadow(0 0 20px rgba(251,191,36,0.4))",
            }}>⚔️ FACTION WARS · PVP</div>
            <div style={{ fontSize: 12, letterSpacing: "0.25em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", marginTop: 4 }}>
              CHALLENGE A FRIEND · ASYNC TURN-BASED
            </div>
          </div>

          {/* Identity gate */}
          {!identity ? (
            <div style={{ padding: "28px 24px", borderRadius: 14, border: "1px solid rgba(251,191,36,0.25)", background: "rgba(251,191,36,0.04)", textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "#fbbf24", marginBottom: 10 }}>
                🔒 Sign in required
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.7, color: "rgba(255,255,255,0.7)", marginBottom: 18 }}>
                PvP requires a stable identity so opponents can't impersonate you.
                Claim a commander name or connect Discord first.
              </div>
              <Link href="/" style={{ display: "inline-block", padding: "10px 20px", borderRadius: 20, border: "1px solid rgba(251,191,36,0.4)", background: "linear-gradient(135deg,rgba(251,191,36,0.25),rgba(248,113,113,0.25))", color: "#fbbf24", fontWeight: 900, fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", textDecoration: "none" }}>
                Go sign in
              </Link>
            </div>
          ) : (
            <>
              {/* Create challenge */}
              <div style={{ padding: "20px 22px", borderRadius: 14, border: "1px solid rgba(251,191,36,0.25)", background: "rgba(251,191,36,0.03)", marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "#fbbf24", marginBottom: 8 }}>
                  Create a Challenge
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.7, color: "rgba(255,255,255,0.6)", marginBottom: 14 }}>
                  Generate a shareable link. Send it to a friend. They click, accept, pick their 5 factions, and the match starts.
                </div>
                {/* Wager tier picker (Layer 2A) */}
                {pvpEnabled && pvpTiers.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>
                      Choose Wager
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {pvpTiers.map((tier) => {
                        const isSelected = selectedTier === tier;
                        const bal = balance ?? 0;
                        const tierCantAfford = balance !== null && bal < tier;
                        return (
                          <button
                            key={tier}
                            onClick={() => setSelectedTier(tier)}
                            disabled={creating}
                            style={{
                              minWidth: 64,
                              height: 36,
                              padding: "0 12px",
                              fontSize: 11,
                              fontWeight: 800,
                              letterSpacing: "0.05em",
                              borderRadius: 18,
                              border: `1px solid ${isSelected ? "rgba(251,191,36,0.7)" : tierCantAfford ? "rgba(248,113,113,0.3)" : "rgba(255,255,255,0.18)"}`,
                              background: isSelected
                                ? "linear-gradient(135deg,rgba(251,191,36,0.35),rgba(248,113,113,0.25))"
                                : "rgba(255,255,255,0.04)",
                              color: isSelected ? "#fbbf24" : tierCantAfford ? "rgba(248,113,113,0.7)" : "rgba(255,255,255,0.7)",
                              cursor: creating ? "wait" : "pointer",
                              filter: isSelected ? "drop-shadow(0 0 8px rgba(251,191,36,0.3))" : "none",
                              transition: "all 0.15s ease",
                            }}
                            title={tierCantAfford ? `Need ${tier} REBEL` : `Wager ${tier} REBEL`}
                          >
                            {tier.toLocaleString()}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {(() => {
                  // Compute affordability + state of the Create button
                  // Variable wager (Layer 2A): cost is the chosen tier (or 0 if free).
                  const cost = selectedTier ?? pvpCost ?? 0;
                  const bal = balance ?? 0;
                  const cantAfford = selectedTier !== null && balance !== null && bal < cost;
                  const disabled = creating || !pvpEnabled || cantAfford || selectedTier === null;
                  const label = creating
                    ? "Creating…"
                    : !pvpEnabled
                    ? "PvP Disabled"
                    : cantAfford
                    ? `Need ${cost} REBEL (you have ${bal})`
                    : cost > 0
                    ? `⚔️ Create Challenge — ${cost} REBEL`
                    : "⚔️ Create Challenge";
                  return (
                    <>
                      <button
                        onClick={handleCreate}
                        disabled={disabled}
                        style={{
                          minWidth: 280, height: 48, padding: "0 28px", fontSize: 13, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase",
                          borderRadius: 24, border: `1px solid ${disabled ? "rgba(255,255,255,0.18)" : "rgba(251,191,36,0.5)"}`,
                          background: disabled ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg,rgba(251,191,36,0.3),rgba(248,113,113,0.3))",
                          color: disabled ? "rgba(255,255,255,0.4)" : "#fbbf24",
                          cursor: creating ? "wait" : disabled ? "not-allowed" : "pointer",
                          filter: disabled ? "none" : "drop-shadow(0 0 12px rgba(251,191,36,0.3))",
                        }}
                      >
                        {label}
                      </button>
                      {pvpEnabled && cost > 0 && balance !== null && !cantAfford && (
                        <div style={{ fontSize: 10, opacity: 0.5, marginTop: 6 }}>
                          Winner takes both antes ({cost * 2} REBEL pot). Refunded if you cancel before opponent accepts.
                        </div>
                      )}
                    </>
                  );
                })()}
                {createError && <div style={{ marginTop: 10, fontSize: 11, color: "#f87171" }}>{createError}</div>}
                <div style={{ marginTop: 14, fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em" }}>
                  Playing as <b style={{ color: "rgba(255,255,255,0.7)" }}>{identity.displayName}</b>
                </div>
              </div>

              {/* Active matches */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 12, fontWeight: 700 }}>
                  Your Active Matches {activeMatches.length > 0 && `(${activeMatches.length})`}
                </div>
                {loading && matches.length === 0 ? (
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", padding: "20px 0", textAlign: "center" }}>Loading…</div>
                ) : activeMatches.length === 0 ? (
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", padding: "20px 0", textAlign: "center", fontStyle: "italic" }}>
                    No active matches. Create a challenge above to start one.
                  </div>
                ) : (
                  activeMatches.map((m) => <MatchCard key={m.challengeId} match={m} mePlayerId={identity.playerId} />)
                )}
              </div>

              {/* Completed matches (collapsed) */}
              {completedMatches.length > 0 && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                    <button
                      onClick={() => setShowCompleted((v) => !v)}
                      style={{
                        background: "none", border: "none", color: "rgba(255,255,255,0.5)",
                        fontSize: 11, letterSpacing: "0.25em", textTransform: "uppercase", fontWeight: 700,
                        fontFamily: JP, cursor: "pointer", padding: 0,
                      }}
                    >
                      {showCompleted ? "▼" : "▶"} Completed ({completedMatches.length})
                    </button>
                    <button
                      onClick={clearCompleted}
                      disabled={clearBusy}
                      title="Hide all completed matches from your view (your opponent still sees them)"
                      style={{
                        background: clearBusy ? "rgba(255,255,255,0.04)" : "rgba(248,113,113,0.08)",
                        border: `1px solid ${clearBusy ? "rgba(255,255,255,0.12)" : "rgba(248,113,113,0.3)"}`,
                        borderRadius: 50, padding: "4px 12px",
                        fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", fontWeight: 700,
                        fontFamily: JP,
                        color: clearBusy ? "rgba(255,255,255,0.4)" : "#fca5a5",
                        cursor: clearBusy ? "wait" : "pointer",
                      }}
                    >
                      {clearBusy ? "Clearing…" : "🗑 Clear"}
                    </button>
                    {clearError && (
                      <span style={{ fontSize: 10, color: "#fca5a5", opacity: 0.8 }}>{clearError}</span>
                    )}
                  </div>
                  {showCompleted && completedMatches.map((m) => <MatchCard key={m.challengeId} match={m} mePlayerId={identity.playerId} />)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
