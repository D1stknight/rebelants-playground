// /faction-wars/spectate/{challengeId}
//
// Read-only spectator view of a PvP match. Anyone with the link can watch —
// no auth required (works for private matches too if you have the URL).
// The lobby's "⚔️ Live Matches" only lists non-private matches; private
// matches must be shared via the direct spectate link.
//
// Polling: GET /api/faction-wars/pvp/get every 3s for state, every 10s a
// spectator-ping fires so the viewer count updates. Both stop when the
// page is hidden (visibilitychange) and resume on focus to save bandwidth.

import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { FACTIONS, MAX_HP, TEAM_SIZE, TERRITORY_COUNT } from "../../../lib/factionWarsCore";
import type { PvpMatch, PvpRound } from "../../../lib/types/fwpvp";

const JP =
  '"Noto Serif JP", "Hiragino Mincho ProN", serif';

function makeViewerKey(): string {
  // Per-tab random id. Not persisted; two tabs are two viewers, fine for V1.
  if (typeof window === "undefined") return "ssr";
  const r = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36);
  return `${t}-${r}`;
}

export default function SpectatePage() {
  const router = useRouter();
  const challengeId = String(router.query.challengeId || "");
  const [match, setMatch] = useState<PvpMatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState<number | null>(null);
  const viewerKeyRef = useRef<string>(makeViewerKey());
  const stoppedRef = useRef<boolean>(false);

  // ── Match state polling (every 3s) ────────────────────────────────────────
  useEffect(() => {
    if (!challengeId) return;
    let cancelled = false;
    let timer: any = null;
    const tick = async () => {
      if (cancelled || stoppedRef.current) return;
      try {
        const r = await fetch(`/api/faction-wars/pvp/get?id=${encodeURIComponent(challengeId)}`);
        const j = await r.json();
        if (cancelled) return;
        if (j.ok && j.match) {
          setMatch(j.match as PvpMatch);
          setError(null);
        } else if (j.error) {
          setError(j.error);
        }
      } catch (e: any) {
        // Network blip — ignore, next tick will retry.
      } finally {
        if (!cancelled) timer = setTimeout(tick, 3000);
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [challengeId]);

  // ── Spectator presence ping (every 10s) + viewer count poll (every 5s) ────
  useEffect(() => {
    if (!challengeId) return;
    let cancelled = false;
    let pingTimer: any = null;
    let countTimer: any = null;
    const ping = async () => {
      if (cancelled) return;
      try {
        await fetch("/api/faction-wars/pvp/spectator-ping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challengeId, viewerKey: viewerKeyRef.current }),
        });
      } catch {}
      finally { if (!cancelled) pingTimer = setTimeout(ping, 10000); }
    };
    const fetchCount = async () => {
      if (cancelled) return;
      try {
        const r = await fetch(`/api/faction-wars/pvp/spectator-count?id=${encodeURIComponent(challengeId)}`);
        const j = await r.json();
        if (!cancelled && j.ok && typeof j.count === "number") {
          setViewerCount(j.count);
        }
      } catch {}
      finally { if (!cancelled) countTimer = setTimeout(fetchCount, 5000); }
    };
    ping();
    fetchCount();
    return () => {
      cancelled = true;
      if (pingTimer) clearTimeout(pingTimer);
      if (countTimer) clearTimeout(countTimer);
    };
  }, [challengeId]);

  // ── Pause polling when tab hidden ─────────────────────────────────────────
  useEffect(() => {
    const onVis = () => {
      stoppedRef.current = document.visibilityState === "hidden";
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // ── Derived display data ─────────────────────────────────────────────────
  const challengerCurrent = useMemo(() => {
    if (!match) return null;
    const id = match.challengerTeam[match.challengerCurrentFactionIndex];
    return id ? FACTIONS[id] : null;
  }, [match]);
  const opponentCurrent = useMemo(() => {
    if (!match) return null;
    const id = match.opponentTeam[match.opponentCurrentFactionIndex];
    return id ? FACTIONS[id] : null;
  }, [match]);
  const recentRounds = useMemo(() => {
    if (!match) return [] as PvpRound[];
    return match.roundHistory.slice(-6).reverse();
  }, [match]);

  const status = match?.status ?? null;
  const isLive = status === "active" || status === "team_selection";
  const isOver = status === "completed" || status === "cancelled";

  return (
    <>
      <Head>
        <title>Spectate · Faction Wars PvP</title>
      </Head>
      <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#0a0a14 0%,#1a0f1f 100%)", color: "white", paddingBottom: 60, fontFamily: JP }}>
        {/* Header */}
        <header style={{ position: "relative", zIndex: 20, maxWidth: 980, margin: "0 auto", padding: "16px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <Link href="/faction-wars/pvp" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "white" }}>
            <span style={{ fontSize: 20, filter: "drop-shadow(0 0 8px rgba(251,191,36,0.6))" }}>←</span>
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>PvP Lobby</span>
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {isLive && (
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.15em", textTransform: "uppercase", color: "#f87171", padding: "4px 10px", borderRadius: 12, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.4)" }}>
                🔴 LIVE
              </div>
            )}
            {viewerCount !== null && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", padding: "4px 10px", borderRadius: 12, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                👁 {viewerCount.toLocaleString()} watching
              </div>
            )}
          </div>
        </header>

        {/* Title */}
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "12px 16px 40px" }}>
          <div style={{ textAlign: "center", marginTop: 14, marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>
              Spectator View
            </div>
            <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: "0.04em", marginTop: 6, background: "linear-gradient(135deg,#fbbf24,#f87171)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Faction Wars · PvP
            </div>
          </div>

          {!match && !error && (
            <div style={{ textAlign: "center", color: "rgba(255,255,255,0.5)", padding: "60px 20px" }}>Loading match…</div>
          )}
          {error && (
            <div style={{ textAlign: "center", color: "#f87171", padding: "60px 20px" }}>
              {error}
            </div>
          )}
          {match && (
            <>
              {/* Vs banner */}
              <div style={{ padding: "20px 22px", borderRadius: 14, border: "1px solid rgba(251,191,36,0.25)", background: "rgba(251,191,36,0.03)", marginBottom: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 12 }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>Challenger</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: "#fbbf24" }}>{match.challengerDisplayName}</div>
                    <div style={{ fontSize: 24, fontWeight: 900, color: "#fbbf24", marginTop: 4 }}>{match.challengerTerritoriesWon}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: "0.2em", color: "rgba(255,255,255,0.35)" }}>VS</div>
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>Opponent</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: "#a5b4fc" }}>{match.opponentDisplayName ?? "—"}</div>
                    <div style={{ fontSize: 24, fontWeight: 900, color: "#a5b4fc", marginTop: 4 }}>{match.opponentTerritoriesWon}</div>
                  </div>
                </div>
                <div style={{ textAlign: "center", marginTop: 12, fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
                  {isOver ? (
                    status === "completed"
                      ? `Match complete · Winner takes ${(Number(match.pvpCost ?? 0) * 2).toLocaleString()} REBEL`
                      : "Match cancelled"
                  ) : (
                    `Territory ${Math.min(TERRITORY_COUNT, match.currentTerritory + 1)} of ${TERRITORY_COUNT} · Wager ${Number(match.pvpCost ?? 0).toLocaleString()} REBEL`
                  )}
                </div>
              </div>

              {/* Current fighters & HP */}
              {isLive && challengerCurrent && opponentCurrent && (
                <div style={{ padding: "20px 22px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)", marginBottom: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 12 }}>
                    Now Fighting
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <FighterCard side="challenger" name={challengerCurrent.name} emoji={challengerCurrent.emoji} color={challengerCurrent.color} hp={match.challengerHp} />
                    <FighterCard side="opponent" name={opponentCurrent.name} emoji={opponentCurrent.emoji} color={opponentCurrent.color} hp={match.opponentHp} />
                  </div>
                </div>
              )}

              {/* Teams */}
              <div style={{ padding: "20px 22px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)", marginBottom: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 12 }}>
                  Teams
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <TeamColumn label="Challenger" team={match.challengerTeam} currentIdx={match.challengerCurrentFactionIndex} status={match.status} accent="#fbbf24" />
                  <TeamColumn label="Opponent" team={match.opponentTeam} currentIdx={match.opponentCurrentFactionIndex} status={match.status} accent="#a5b4fc" />
                </div>
              </div>

              {/* Recent rounds */}
              {recentRounds.length > 0 && (
                <div style={{ padding: "20px 22px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 12 }}>
                    Recent Action
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {recentRounds.map((r, i) => (
                      <RoundRow key={`${r.territory}-${r.roundInTerritory}-${i}`} round={r} match={match} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function FighterCard({ side, name, emoji, color, hp }: { side: "challenger" | "opponent"; name: string; emoji: string; color: string; hp: number }) {
  const accent = side === "challenger" ? "#fbbf24" : "#a5b4fc";
  const pct = Math.max(0, Math.min(100, (hp / MAX_HP) * 100));
  return (
    <div style={{ padding: 14, borderRadius: 10, background: `rgba(255,255,255,0.03)`, border: `1px solid ${color}66` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 28, filter: "drop-shadow(0 0 8px rgba(255,255,255,0.2))" }}>{emoji}</div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)" }}>{side}</div>
          <div style={{ fontSize: 14, fontWeight: 900, color: accent }}>{name}</div>
        </div>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${color}, ${color}cc)`, transition: "width 0.4s ease" }} />
      </div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 6, textAlign: "right" }}>
        {hp} / {MAX_HP} HP
      </div>
    </div>
  );
}

function TeamColumn({ label, team, currentIdx, status, accent }: { label: string; team: string[]; currentIdx: number; status: string; accent: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: 8 }}>
        {label}
      </div>
      {team.length === 0 ? (
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontStyle: "italic" }}>
          {status === "team_selection" ? "Picking factions…" : "—"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {team.map((id, i) => {
            const f = FACTIONS[id as keyof typeof FACTIONS];
            if (!f) return null;
            const isCurrent = i === currentIdx;
            const isDefeated = i < currentIdx;
            return (
              <div key={`${id}-${i}`} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 10px", borderRadius: 8,
                background: isCurrent ? `${accent}15` : "rgba(255,255,255,0.02)",
                border: isCurrent ? `1px solid ${accent}66` : "1px solid rgba(255,255,255,0.06)",
                opacity: isDefeated ? 0.4 : 1,
              }}>
                <span style={{ fontSize: 16 }}>{f.emoji}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: isCurrent ? accent : "rgba(255,255,255,0.7)", textDecoration: isDefeated ? "line-through" : "none" }}>{f.name}</span>
                {isCurrent && (
                  <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 900, letterSpacing: "0.1em", color: accent }}>NOW</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RoundRow({ round, match }: { round: PvpRound; match: PvpMatch }) {
  const attackerName =
    round.attackerSide === "challenger"
      ? match.challengerDisplayName
      : (match.opponentDisplayName || "—");
  const attackerColor = round.attackerSide === "challenger" ? "#fbbf24" : "#a5b4fc";
  const aF = FACTIONS[round.attackerFaction as keyof typeof FACTIONS];
  const dF = FACTIONS[round.defenderFaction as keyof typeof FACTIONS];
  const moveLabel = aF?.moves.find((m: any) => m.id === round.moveId)?.label ?? round.moveId;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.1em", color: "rgba(255,255,255,0.4)", minWidth: 32 }}>T{round.territory + 1}R{round.roundInTerritory}</span>
      <span style={{ fontSize: 14 }}>{aF?.emoji ?? ""}</span>
      <span style={{ color: attackerColor, fontWeight: 700 }}>{attackerName}</span>
      <span style={{ color: "rgba(255,255,255,0.55)" }}>used</span>
      <span style={{ color: "white", fontWeight: 700 }}>{moveLabel}</span>
      <span style={{ marginLeft: "auto", fontWeight: 900, color: round.damageDealt > 0 ? "#f87171" : "rgba(255,255,255,0.4)" }}>
        {round.damageDealt > 0 ? `-${round.damageDealt}` : "0"} dmg
      </span>
    </div>
  );
}
