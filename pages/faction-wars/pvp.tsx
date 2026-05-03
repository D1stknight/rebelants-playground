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

  useEffect(() => {
    if (!identity) return;
    refreshMatches();
    const t = setInterval(refreshMatches, 10000);
    return () => clearInterval(t);
  }, [identity, refreshMatches]);

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
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  style={{
                    minWidth: 240, height: 44, fontSize: 13, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase",
                    borderRadius: 22, border: "1px solid rgba(251,191,36,0.5)",
                    background: creating ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,rgba(251,191,36,0.3),rgba(248,113,113,0.3))",
                    color: creating ? "rgba(255,255,255,0.4)" : "#fbbf24",
                    cursor: creating ? "wait" : "pointer",
                    filter: creating ? "none" : "drop-shadow(0 0 12px rgba(251,191,36,0.3))",
                  }}
                >
                  {creating ? "Creating…" : "⚔️ Create Challenge"}
                </button>
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
                  <button
                    onClick={() => setShowCompleted((v) => !v)}
                    style={{
                      background: "none", border: "none", color: "rgba(255,255,255,0.5)",
                      fontSize: 11, letterSpacing: "0.25em", textTransform: "uppercase", fontWeight: 700,
                      fontFamily: JP, cursor: "pointer", padding: 0, marginBottom: 12,
                    }}
                  >
                    {showCompleted ? "▼" : "▶"} Completed ({completedMatches.length})
                  </button>
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
