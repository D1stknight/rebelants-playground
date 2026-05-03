import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
import { loadProfile, type Profile } from "../../../lib/profile";
import type { PvpMatch } from "../../../lib/types/fwpvp";
import { FACTIONS, FACTION_IDS, TEAM_SIZE, type FactionId } from "../../../lib/factionWarsCore";

const JP = `'Noto Serif JP', 'Hiragino Mincho ProN', serif`;

// ── Identity helper (same as lobby) ──────────────────────────────────────────
function deriveIdentity(p: Profile | null): { playerId: string; displayName: string } | null {
  if (!p) return null;
  if (p.primaryId) return { playerId: p.primaryId, displayName: p.discordName || p.name || "Anonymous" };
  if (p.name && p.name !== "guest" && p.name.trim().length > 0) {
    return { playerId: `commander:${p.name}`, displayName: p.name };
  }
  return null;
}

function factionImgPath(fid: string, type: "symbol" | "char"): string {
  const jpgFactions: Record<string, boolean> = { "bushi-symbol": true, "bushi-char": true };
  const jpgCharFactions: Record<string, boolean> = { "shogun-char": true };
  const key = `${fid}-${type}`;
  const ext = jpgFactions[key] ? "jpg" : jpgCharFactions[key] ? "JPG" : "PNG";
  return `/factions/${fid}-${type}.${ext}`;
}

// ── Faction picker grid (Step 2: just lets you build a 5-faction team) ──────
function TeamPicker({ team, setTeam, onSubmit, busy }: { team: FactionId[]; setTeam: (t: FactionId[]) => void; onSubmit: () => void; busy: boolean }) {
  const toggle = (fid: FactionId) => {
    if (team.includes(fid)) setTeam(team.filter((f) => f !== fid));
    else if (team.length < TEAM_SIZE) setTeam([...team, fid]);
  };
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 900, color: "#fbbf24", letterSpacing: "0.05em", marginBottom: 12 }}>
        ⚔️ Assemble Your Team ({team.length}/{TEAM_SIZE})
      </div>
      {/* Selected slots */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {Array.from({ length: TEAM_SIZE }, (_, i) => {
          const fid = team[i];
          const f = fid ? FACTIONS[fid] : null;
          return (
            <div
              key={i}
              onClick={() => f && setTeam(team.filter((_, j) => j !== i))}
              style={{
                width: 62, height: 78, borderRadius: 10,
                border: f ? `2px solid ${f.borderColor}` : "1px dashed rgba(255,255,255,0.2)",
                background: f ? f.bgColor : "rgba(255,255,255,0.02)",
                cursor: f ? "pointer" : "default", overflow: "hidden",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              }}
              title={f ? `Click to remove ${f.name}` : "Empty slot"}
            >
              {f ? (
                <>
                  <img src={factionImgPath(f.id, "char")} alt={f.name} style={{ width: "100%", height: 55, objectFit: "cover", objectPosition: "top" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <div style={{ fontSize: 7, color: f.color, fontWeight: 900, padding: "2px 0", letterSpacing: "0.05em" }}>{f.name.toUpperCase()}</div>
                </>
              ) : (
                <div style={{ fontSize: 20, opacity: 0.4 }}>＋</div>
              )}
            </div>
          );
        })}
      </div>
      {/* All factions */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(96px,1fr))", gap: 8, marginBottom: 16 }}>
        {FACTION_IDS.map((fid) => {
          const f = FACTIONS[fid];
          const selected = team.includes(fid);
          return (
            <div
              key={fid}
              onClick={() => toggle(fid)}
              style={{
                padding: "8px 6px", borderRadius: 10,
                border: `1px solid ${selected ? f.borderColor : "rgba(255,255,255,0.1)"}`,
                background: selected ? f.bgColor : "rgba(255,255,255,0.02)",
                cursor: "pointer", textAlign: "center",
                opacity: !selected && team.length >= TEAM_SIZE ? 0.4 : 1,
                transition: "all 0.2s",
              }}
            >
              <img src={factionImgPath(fid, "char")} alt={f.name} style={{ width: "100%", height: 70, objectFit: "cover", objectPosition: "top", borderRadius: 6, marginBottom: 4 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <div style={{ fontSize: 9, fontWeight: 900, color: f.color, letterSpacing: "0.05em" }}>{f.name.toUpperCase()}</div>
            </div>
          );
        })}
      </div>
      <button
        onClick={onSubmit}
        disabled={team.length !== TEAM_SIZE || busy}
        style={{
          width: "100%", height: 46, fontSize: 13, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase",
          borderRadius: 24, border: "1px solid rgba(251,191,36,0.4)",
          background: team.length === TEAM_SIZE && !busy ? "linear-gradient(135deg,rgba(251,191,36,0.3),rgba(248,113,113,0.3))" : "rgba(255,255,255,0.05)",
          color: team.length === TEAM_SIZE && !busy ? "#fbbf24" : "rgba(255,255,255,0.4)",
          cursor: team.length === TEAM_SIZE && !busy ? "pointer" : "not-allowed",
        }}
      >
        {busy ? "Locking team…" : team.length === TEAM_SIZE ? "Lock in team" : `Pick ${TEAM_SIZE - team.length} more`}
      </button>
    </div>
  );
}

// ── Active match view (Step 2: read-only, no move submission yet) ───────────
function ActiveMatchView({ match, mePlayerId }: { match: PvpMatch; mePlayerId: string }) {
  const isChallenger = match.challengerPlayerId === mePlayerId;
  const mySide = isChallenger ? "challenger" : "opponent";
  const myTeam = isChallenger ? match.challengerTeam : match.opponentTeam;
  const oppTeam = isChallenger ? match.opponentTeam : match.challengerTeam;
  const myIdx = isChallenger ? match.challengerCurrentFactionIndex : match.opponentCurrentFactionIndex;
  const oppIdx = isChallenger ? match.opponentCurrentFactionIndex : match.challengerCurrentFactionIndex;
  const myHp = isChallenger ? match.challengerHp : match.opponentHp;
  const oppHp = isChallenger ? match.opponentHp : match.challengerHp;
  const isMyTurn = match.currentTurnPlayerId === mePlayerId;

  const myFighter = myTeam[myIdx];
  const oppFighter = oppTeam[oppIdx];
  const myF = myFighter ? FACTIONS[myFighter] : null;
  const oppF = oppFighter ? FACTIONS[oppFighter] : null;

  return (
    <div>
      {/* Turn indicator */}
      <div style={{
        textAlign: "center", padding: "12px 16px", borderRadius: 12, marginBottom: 18,
        background: isMyTurn ? "linear-gradient(135deg,rgba(251,191,36,0.2),rgba(248,113,113,0.2))" : "rgba(255,255,255,0.03)",
        border: `1px solid ${isMyTurn ? "rgba(251,191,36,0.5)" : "rgba(255,255,255,0.08)"}`,
      }}>
        <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: "0.15em", textTransform: "uppercase", color: isMyTurn ? "#fbbf24" : "rgba(255,255,255,0.6)" }}>
          {isMyTurn ? "⚔️ Your Turn" : "Waiting for opponent…"}
        </div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 4, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Territory {Math.min(match.currentTerritory + 1, 5)} / 5 · {match.challengerTerritoriesWon}–{match.opponentTerritoriesWon}
        </div>
      </div>

      {/* Fighters */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "center", marginBottom: 18 }}>
        {/* Me */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.15em", textTransform: "uppercase" }}>You</div>
          {myF && (
            <>
              <div style={{ position: "relative", width: 110, height: 130, borderRadius: 12, overflow: "hidden", border: `3px solid ${myF.borderColor}`, margin: "0 auto" }}>
                <img src={factionImgPath(myF.id, "char")} alt={myF.name} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
              <div style={{ fontWeight: 900, fontSize: 12, color: myF.color, marginTop: 6 }}>{myF.name.toUpperCase()}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>HP {myHp}/100</div>
            </>
          )}
        </div>
        <div style={{ fontSize: 24, fontWeight: 900, opacity: 0.5 }}>VS</div>
        {/* Opponent */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.15em", textTransform: "uppercase" }}>Opponent</div>
          {oppF && (
            <>
              <div style={{ position: "relative", width: 110, height: 130, borderRadius: 12, overflow: "hidden", border: `3px solid ${oppF.borderColor}`, margin: "0 auto" }}>
                <img src={factionImgPath(oppF.id, "char")} alt={oppF.name} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
              <div style={{ fontWeight: 900, fontSize: 12, color: oppF.color, marginTop: 6 }}>{oppF.name.toUpperCase()}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>HP {oppHp}/100</div>
            </>
          )}
        </div>
      </div>

      {/* Step 3 placeholder */}
      <div style={{ padding: "16px 20px", borderRadius: 12, border: "1px dashed rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.02)", textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        Move submission coming in Step 3
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function ChallengePage() {
  const router = useRouter();
  const challengeId = typeof router.query.challengeId === "string" ? router.query.challengeId : "";

  const [profile, setProfile] = useState<Profile | null>(null);
  const [identity, setIdentity] = useState<{ playerId: string; displayName: string } | null>(null);
  const [match, setMatch] = useState<PvpMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [team, setTeam] = useState<FactionId[]>([]);
  const [copied, setCopied] = useState(false);

  // Load profile + identity once
  useEffect(() => {
    const p = loadProfile();
    setProfile(p);
    setIdentity(deriveIdentity(p));
  }, []);

  // Fetch match (poll while not completed/cancelled)
  const refreshMatch = useCallback(async () => {
    if (!challengeId) return;
    try {
      const r = await fetch(`/api/faction-wars/pvp/get?id=${encodeURIComponent(challengeId)}`);
      const j = await r.json();
      if (!j.ok) {
        setError(j.error || "Match not found");
        setMatch(null);
      } else {
        setMatch(j.match as PvpMatch);
        setError(null);
      }
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, [challengeId]);

  useEffect(() => {
    if (!challengeId) return;
    refreshMatch();
  }, [challengeId, refreshMatch]);

  useEffect(() => {
    if (!match) return;
    if (match.status === "completed" || match.status === "cancelled") return;
    const t = setInterval(refreshMatch, 5000);
    return () => clearInterval(t);
  }, [match, refreshMatch]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleAccept = async () => {
    if (!identity || !match) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/faction-wars/pvp/accept", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, opponentPlayerId: identity.playerId, opponentDisplayName: identity.displayName }),
      });
      const j = await r.json();
      if (!j.ok) setError(j.error || "Accept failed");
      else setMatch(j.match);
    } catch (e: any) { setError(e?.message || "Network error"); } finally { setBusy(false); }
  };

  const handleSubmitTeam = async () => {
    if (!identity || !match || team.length !== TEAM_SIZE) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/faction-wars/pvp/select-team", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, playerId: identity.playerId, team }),
      });
      const j = await r.json();
      if (!j.ok) setError(j.error || "Team submission failed");
      else setMatch(j.match);
    } catch (e: any) { setError(e?.message || "Network error"); } finally { setBusy(false); }
  };

  const handleCancel = async () => {
    if (!identity || !match) return;
    if (!confirm("Cancel this challenge? It cannot be undone.")) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/faction-wars/pvp/cancel", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, playerId: identity.playerId }),
      });
      const j = await r.json();
      if (!j.ok) setError(j.error || "Cancel failed");
      else setMatch(j.match);
    } catch (e: any) { setError(e?.message || "Network error"); } finally { setBusy(false); }
  };

  const copyShareLink = () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/faction-wars/challenge/${challengeId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const isChallenger = match && identity && match.challengerPlayerId === identity.playerId;
  const isOpponent = match && identity && match.opponentPlayerId === identity.playerId;
  const isParticipant = isChallenger || isOpponent;
  const myTeamLocked = match && identity && (
    (isChallenger && match.challengerTeam.length === TEAM_SIZE) ||
    (isOpponent && match.opponentTeam.length === TEAM_SIZE)
  );

  return (
    <>
      <Head>
        <title>{match ? `vs ${isChallenger ? match.opponentDisplayName || "?" : match.challengerDisplayName} · Faction Wars PvP` : "Faction Wars PvP"}</title>
      </Head>
      <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#0a0a14 0%,#1a0f1f 100%)", color: "white", paddingBottom: 60 }}>
        {/* Header */}
        <header style={{ position: "relative", zIndex: 20, maxWidth: 980, margin: "0 auto", padding: "16px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: JP }}>
          <Link href="/faction-wars/pvp" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "white" }}>
            <span style={{ fontSize: 20, filter: "drop-shadow(0 0 8px rgba(251,191,36,0.6))" }}>←</span>
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>PvP Lobby</span>
          </Link>
        </header>

        <div style={{ maxWidth: 720, margin: "0 auto", padding: "12px 16px 40px", fontFamily: JP }}>
          {/* Title */}
          <div style={{ textAlign: "center", marginBottom: 24, marginTop: 14 }}>
            <div style={{
              fontSize: "clamp(20px,3.5vw,32px)", fontWeight: 900, letterSpacing: "0.15em", textTransform: "uppercase",
              background: "linear-gradient(135deg,#fbbf24,#f87171,#c084fc)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
            }}>
              {match ? `${match.challengerDisplayName} vs ${match.opponentDisplayName || "?"}` : "Loading match…"}
            </div>
          </div>

          {error && (
            <div style={{ padding: "12px 16px", borderRadius: 10, border: "1px solid rgba(248,113,113,0.4)", background: "rgba(248,113,113,0.08)", color: "#f87171", fontSize: 12, marginBottom: 16 }}>
              ⚠️ {error}
            </div>
          )}

          {/* Identity gate */}
          {!identity && (
            <div style={{ padding: "24px 22px", borderRadius: 14, border: "1px solid rgba(251,191,36,0.25)", background: "rgba(251,191,36,0.04)", textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: "#fbbf24", marginBottom: 10, letterSpacing: "0.1em", textTransform: "uppercase" }}>🔒 Sign in to play</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginBottom: 16, lineHeight: 1.7 }}>
                You need a commander name or Discord login to participate in PvP.
              </div>
              <Link href="/" style={{ display: "inline-block", padding: "10px 20px", borderRadius: 20, border: "1px solid rgba(251,191,36,0.4)", background: "linear-gradient(135deg,rgba(251,191,36,0.25),rgba(248,113,113,0.25))", color: "#fbbf24", fontWeight: 900, fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", textDecoration: "none" }}>Go sign in</Link>
            </div>
          )}

          {loading && !match && <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.4)" }}>Loading…</div>}

          {match && identity && (
            <>
              {/* PENDING — challenger sees share link, viewer sees Accept */}
              {match.status === "pending" && (
                <>
                  {isChallenger ? (
                    <div style={{ padding: "20px 22px", borderRadius: 14, border: "1px solid rgba(88,101,242,0.3)", background: "rgba(88,101,242,0.05)" }}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: "#a5b4fc", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
                        Share this link with your friend
                      </div>
                      <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,0.4)", fontFamily: "ui-monospace, monospace", fontSize: 11, color: "rgba(255,255,255,0.8)", wordBreak: "break-all", marginBottom: 12 }}>
                        {typeof window !== "undefined" ? window.location.href : ""}
                      </div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button onClick={copyShareLink} style={{ padding: "8px 16px", borderRadius: 18, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.05)", color: "white", fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer" }}>
                          {copied ? "✓ Copied" : "Copy link"}
                        </button>
                        <button onClick={handleCancel} disabled={busy} style={{ padding: "8px 16px", borderRadius: 18, border: "1px solid rgba(248,113,113,0.4)", background: "rgba(248,113,113,0.05)", color: "#f87171", fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", cursor: busy ? "wait" : "pointer" }}>
                          Cancel challenge
                        </button>
                      </div>
                      <div style={{ marginTop: 14, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Waiting for opponent to accept…</div>
                    </div>
                  ) : (
                    <div style={{ padding: "24px 22px", borderRadius: 14, border: "1px solid rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.05)", textAlign: "center" }}>
                      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginBottom: 6, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                        You've been challenged by
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: "#fbbf24", marginBottom: 18, letterSpacing: "0.05em" }}>
                        {match.challengerDisplayName}
                      </div>
                      <button onClick={handleAccept} disabled={busy} style={{ minWidth: 200, height: 46, fontSize: 13, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", borderRadius: 24, border: "1px solid rgba(251,191,36,0.5)", background: busy ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,rgba(251,191,36,0.3),rgba(248,113,113,0.3))", color: busy ? "rgba(255,255,255,0.4)" : "#fbbf24", cursor: busy ? "wait" : "pointer" }}>
                        {busy ? "Accepting…" : "⚔️ Accept Challenge"}
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* TEAM_SELECTION — both pick teams */}
              {match.status === "team_selection" && isParticipant && (
                <div>
                  {myTeamLocked ? (
                    <div style={{ padding: "24px 22px", borderRadius: 14, border: "1px solid rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.04)", textAlign: "center" }}>
                      <div style={{ fontSize: 14, fontWeight: 900, color: "#fbbf24", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
                        ✓ Your team is locked
                      </div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 1.7 }}>
                        Waiting for opponent to lock their team…
                      </div>
                    </div>
                  ) : (
                    <TeamPicker team={team} setTeam={setTeam} onSubmit={handleSubmitTeam} busy={busy} />
                  )}
                </div>
              )}

              {/* ACTIVE */}
              {match.status === "active" && isParticipant && (
                <ActiveMatchView match={match} mePlayerId={identity.playerId} />
              )}

              {/* COMPLETED */}
              {match.status === "completed" && (
                <div style={{ padding: "28px 22px", borderRadius: 14, border: "1px solid rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.05)", textAlign: "center" }}>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>Match Complete</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: "#fbbf24", marginBottom: 6 }}>
                    {match.winnerPlayerId === identity.playerId ? "🏆 Victory" : match.loserPlayerId === identity.playerId ? "💀 Defeat" : "Draw"}
                  </div>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginBottom: 14 }}>
                    Final: {match.challengerTerritoriesWon}–{match.opponentTerritoriesWon}
                  </div>
                  {match.winnerPlayerId === identity.playerId && match.winnerCrateRarity && (
                    <div style={{ fontSize: 12, color: "#fbbf24", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                      🎁 {match.winnerCrateRarity} crate earned
                    </div>
                  )}
                </div>
              )}

              {/* CANCELLED */}
              {match.status === "cancelled" && (
                <div style={{ padding: "20px 22px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.02)", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
                  This challenge was cancelled.
                </div>
              )}

              {/* Non-participant viewing an in-progress match */}
              {!isParticipant && match.status !== "pending" && match.status !== "completed" && match.status !== "cancelled" && (
                <div style={{ padding: "20px 22px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.02)", textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
                  This match is between {match.challengerDisplayName} and {match.opponentDisplayName}. You can't join an in-progress challenge.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
