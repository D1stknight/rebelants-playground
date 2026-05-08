// pages/tournament.tsx
//
// Cinematic tournament viewer for FW PvP. Shows:
//   - Active tournaments selector (top)
//   - Selected tournament: full bracket with animated SVG connectors,
//     camera fly-by between rounds, glowing live matches, champion crown
//
// Background: same /bg/faction-wars-bg.png hero used across FW pages.
// Bracket renders as a horizontally-scrolling SVG-overlaid grid. Match cards
// are absolutely positioned over an SVG layer that draws bezier connectors.

import { useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import type { Tournament, TournamentBracketSlot, TournamentRound, TournamentParticipant } from "../lib/types/fwpvp";
import { loadProfile, type Profile } from "../lib/profile";

const JP = '"Segoe UI",sans-serif';

// Card sizing
const CARD_W = 280;
const CARD_H = 92;
const COL_GAP = 80;
const ROW_GAP = 36;

type IdentityShape = { playerId: string; displayName: string } | null;

function deriveIdentity(p: Profile | null): IdentityShape {
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

// ─────────────────────────────────────────────────────────────────────────
// Layout: returns absolute (x,y) for each (round, slot) so we can render
// match cards and SVG connectors aligned together.

interface SlotPosition { x: number; y: number; }
function computeLayout(rounds: TournamentRound[]): SlotPosition[][] {
  // Total height = round 0's height (largest)
  const r0Count = rounds[0]?.matches.length || 0;
  const totalH = r0Count * (CARD_H + ROW_GAP);
  const positions: SlotPosition[][] = [];
  for (let r = 0; r < rounds.length; r++) {
    const round = rounds[r];
    const slotsInRound = round.matches.length;
    // Vertical spacing for this round
    const slotSpan = totalH / slotsInRound;
    const colX = r * (CARD_W + COL_GAP);
    const slots: SlotPosition[] = [];
    for (let s = 0; s < slotsInRound; s++) {
      const cy = s * slotSpan + slotSpan / 2;
      const y = cy - CARD_H / 2;
      slots.push({ x: colX, y });
    }
    positions.push(slots);
  }
  return positions;
}

// Compute total bracket width/height for the SVG viewport
function bracketDimensions(rounds: TournamentRound[]) {
  const numRounds = rounds.length;
  const w = numRounds * CARD_W + (numRounds - 1) * COL_GAP;
  const r0Count = rounds[0]?.matches.length || 0;
  const h = r0Count * (CARD_H + ROW_GAP);
  return { w, h };
}

// ─────────────────────────────────────────────────────────────────────────
// Connector SVG paths between rounds

function ConnectorLayer({ rounds, positions, w, h }: {
  rounds: TournamentRound[];
  positions: SlotPosition[][];
  w: number;
  h: number;
}) {
  const paths: { d: string; active: boolean; key: string }[] = [];
  for (let r = 0; r < rounds.length - 1; r++) {
    const round = rounds[r];
    const next = rounds[r + 1];
    for (let s = 0; s < round.matches.length; s++) {
      const slot = round.matches[s];
      const start = positions[r][s];
      const nextIdx = Math.floor(s / 2);
      const end = positions[r + 1][nextIdx];
      const startX = start.x + CARD_W;
      const startY = start.y + CARD_H / 2;
      const endX = end.x;
      const endY = end.y + CARD_H / 2;
      const midX = (startX + endX) / 2;
      const d = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
      const isActive = !!slot.winner;
      paths.push({ d, active: isActive, key: `r${r}s${s}` });
    }
  }
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}
    >
      <defs>
        <linearGradient id="connGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#facc15" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#fb923c" stopOpacity="0.95" />
        </linearGradient>
        <filter id="connGlow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {paths.map(p => (
        <path
          key={p.key}
          d={p.d}
          fill="none"
          stroke={p.active ? "url(#connGrad)" : "rgba(148,163,184,0.4)"}
          strokeWidth={p.active ? 3 : 2}
          strokeDasharray={p.active ? "none" : "6 6"}
          filter={p.active ? "url(#connGlow)" : undefined}
          style={p.active ? { animation: "connPulse 2.4s ease-in-out infinite" } : undefined}
        />
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Single match card

function MatchCard({ slot, round, t, position, isActive, onClickWatch }: {
  slot: TournamentBracketSlot;
  round: TournamentRound;
  t: Tournament;
  position: SlotPosition;
  isActive: boolean;
  onClickWatch: (challengeId: string) => void;
}) {
  const nameOf = (pid: string | null) => {
    if (!pid) return null;
    const p = t.participants.find(x => x.playerId === pid);
    return p ? p.displayName : pid.slice(0, 12);
  };

  const isPending = !slot.p1 || !slot.p2;
  const isComplete = !!slot.winner;
  const isLive = !!slot.challengeId && !slot.winner;

  const p1Name = nameOf(slot.p1);
  const p2Name = nameOf(slot.p2);
  const p1IsWinner = slot.winner && slot.winner === slot.p1;
  const p2IsWinner = slot.winner && slot.winner === slot.p2;
  const p1IsLoser = isComplete && !p1IsWinner && !!slot.p1;
  const p2IsLoser = isComplete && !p2IsWinner && !!slot.p2;

  const borderColor = isComplete
    ? "rgba(250, 204, 21, 0.85)"
    : isLive
      ? "rgba(248, 113, 113, 0.9)"
      : isPending
        ? "rgba(148, 163, 184, 0.3)"
        : "rgba(148, 163, 184, 0.6)";

  const bgGradient = isComplete
    ? "linear-gradient(135deg, rgba(120,53,15,0.85) 0%, rgba(20,14,4,0.92) 100%)"
    : isLive
      ? "linear-gradient(135deg, rgba(127,29,29,0.85) 0%, rgba(20,4,4,0.92) 100%)"
      : "linear-gradient(135deg, rgba(15,23,42,0.92) 0%, rgba(2,6,23,0.95) 100%)";

  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: CARD_W,
        height: CARD_H,
        background: bgGradient,
        border: `2px solid ${borderColor}`,
        borderRadius: 10,
        boxShadow: isLive
          ? "0 0 24px rgba(248,113,113,0.55), inset 0 0 12px rgba(248,113,113,0.2)"
          : isComplete
            ? "0 0 18px rgba(250,204,21,0.4), inset 0 0 8px rgba(250,204,21,0.15)"
            : "0 4px 16px rgba(0,0,0,0.4)",
        animation: isLive ? "liveBorderPulse 1.6s ease-in-out infinite" : undefined,
        overflow: "hidden",
        backdropFilter: "blur(2px)",
        cursor: isLive ? "pointer" : "default",
      }}
      onClick={() => { if (isLive && slot.challengeId) onClickWatch(slot.challengeId); }}
    >
      {/* Round indicator at top */}
      <div style={{
        position: "absolute", top: 4, right: 8,
        fontSize: 9, color: "rgba(203,213,225,0.6)",
        letterSpacing: 1.2, fontWeight: 600, textTransform: "uppercase",
      }}>
        {isLive ? "● LIVE" : isComplete ? "✓ DONE" : isPending ? "WAITING" : "READY"}
      </div>

      {/* Pot indicator */}
      <div style={{
        position: "absolute", top: 4, left: 8,
        fontSize: 9, color: "rgba(250,204,21,0.85)",
        letterSpacing: 0.6, fontWeight: 600,
      }}>
        💰 {round.potThisRound} REBEL
      </div>

      {/* Player rows */}
      <div style={{ position: "absolute", inset: "20px 12px 8px 12px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <PlayerRow name={p1Name} isWinner={!!p1IsWinner} isLoser={!!p1IsLoser} />
        <div style={{ height: 1, background: "rgba(148,163,184,0.25)", margin: "4px 0" }} />
        <PlayerRow name={p2Name} isWinner={!!p2IsWinner} isLoser={!!p2IsLoser} />
      </div>
    </div>
  );
}

function PlayerRow({ name, isWinner, isLoser }: { name: string | null; isWinner: boolean; isLoser: boolean; }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      fontFamily: JP, fontSize: 14, fontWeight: isWinner ? 700 : 500,
      color: isWinner ? "#facc15" : isLoser ? "rgba(148,163,184,0.5)" : "white",
      textDecoration: isLoser ? "line-through" : "none",
      letterSpacing: 0.3,
    }}>
      {isWinner && <span style={{ fontSize: 14 }}>👑</span>}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
        {name || <span style={{ color: "rgba(148,163,184,0.5)", fontStyle: "italic" }}>TBD</span>}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Round labels above each column

function RoundLabels({ rounds, positions }: { rounds: TournamentRound[]; positions: SlotPosition[][]; }) {
  const labels: { x: number; text: string; key: string }[] = [];
  for (let r = 0; r < rounds.length; r++) {
    const numMatches = rounds[r].matches.length;
    let text: string;
    if (r === rounds.length - 1) text = "🏆 FINALS";
    else if (r === rounds.length - 2) text = "SEMIFINALS";
    else if (r === rounds.length - 3) text = "QUARTERFINALS";
    else text = `ROUND ${r + 1}`;
    text += `  ·  ${numMatches} ${numMatches === 1 ? "MATCH" : "MATCHES"}`;
    labels.push({ x: positions[r][0]?.x || 0, text, key: `lbl${r}` });
  }
  return (
    <>
      {labels.map(l => (
        <div key={l.key} style={{
          position: "absolute", left: l.x, top: -38,
          width: CARD_W,
          fontFamily: JP, fontSize: 11, fontWeight: 700,
          color: "rgba(250,204,21,0.85)",
          letterSpacing: 1.5, textAlign: "center",
          textTransform: "uppercase",
          textShadow: "0 0 12px rgba(250,204,21,0.4)",
        }}>{l.text}</div>
      ))}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Champion banner (animated)

function ChampionBanner({ tournament }: { tournament: Tournament }) {
  if (!tournament.championPlayerId || tournament.status !== "completed") return null;
  const champ = tournament.participants.find(p => p.playerId === tournament.championPlayerId);
  return (
    <div style={{
      position: "fixed", top: 80, left: 0, right: 0, zIndex: 30,
      display: "flex", justifyContent: "center", pointerEvents: "none",
      animation: "champFloat 3s ease-in-out infinite",
    }}>
      <div style={{
        background: "linear-gradient(135deg, rgba(180,83,9,0.96) 0%, rgba(120,53,15,0.96) 50%, rgba(180,83,9,0.96) 100%)",
        backgroundSize: "200% 100%",
        animation: "champShimmer 4s linear infinite",
        border: "3px solid #facc15",
        borderRadius: 14,
        padding: "14px 36px",
        fontFamily: JP, fontSize: 22, fontWeight: 800,
        color: "white",
        letterSpacing: 1.5,
        textShadow: "0 2px 8px rgba(0,0,0,0.6)",
        boxShadow: "0 0 50px rgba(250,204,21,0.6), inset 0 0 24px rgba(250,204,21,0.3)",
      }}>
        🏆 CHAMPION: {champ?.displayName || "Unknown"}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Camera controller — auto-pans the bracket to focus the active round

function useCameraFocus(tournament: Tournament | null, viewportRef: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    if (!tournament || !viewportRef.current) return;
    // Find the most recent live or pending round
    let focusRound = 0;
    for (let r = 0; r < tournament.rounds.length; r++) {
      const anyIncomplete = tournament.rounds[r].matches.some(m => !m.winner && (m.p1 || m.p2));
      if (anyIncomplete) { focusRound = r; break; }
      if (r === tournament.rounds.length - 1) focusRound = r; // completed final
    }
    const targetX = focusRound * (CARD_W + COL_GAP);
    // Smooth scroll the viewport
    viewportRef.current.scrollTo({ left: Math.max(0, targetX - 60), behavior: "smooth" });
  }, [tournament?.id, tournament?.rounds.map(r => r.matches.map(m => m.winner ? 1 : 0).join("")).join("|")]);
}

// ─────────────────────────────────────────────────────────────────────────
// Bracket viewport

function BracketView({ tournament, onWatchMatch }: { tournament: Tournament; onWatchMatch: (challengeId: string) => void; }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  useCameraFocus(tournament, viewportRef);

  const positions = useMemo(() => computeLayout(tournament.rounds), [tournament]);
  const { w, h } = useMemo(() => bracketDimensions(tournament.rounds), [tournament]);

  return (
    <div
      ref={viewportRef}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 1240,
        margin: "0 auto",
        marginTop: 60,
        overflowX: "auto",
        overflowY: "hidden",
        padding: "60px 20px 20px",
        scrollBehavior: "smooth",
      }}
    >
      <div style={{ position: "relative", width: w, height: h, transition: "transform 0.8s cubic-bezier(0.22, 1, 0.36, 1)" }}>
        <RoundLabels rounds={tournament.rounds} positions={positions} />
        <ConnectorLayer rounds={tournament.rounds} positions={positions} w={w} h={h} />
        {tournament.rounds.map((round, ri) => (
          round.matches.map((slot, si) => (
            <MatchCard
              key={`r${ri}s${si}`}
              slot={slot}
              round={round}
              t={tournament}
              position={positions[ri][si]}
              isActive={!!slot.challengeId && !slot.winner}
              onClickWatch={onWatchMatch}
            />
          ))
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Tournaments selector card list

function TournamentsList({ tournaments, selectedId, onSelect }: {
  tournaments: Tournament[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  if (tournaments.length === 0) {
    return (
      <div style={{
        background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.3)",
        borderRadius: 10, padding: 24, textAlign: "center",
        fontFamily: JP, color: "rgba(203,213,225,0.85)",
      }}>
        No active tournaments yet. Check back soon — admins schedule them regularly. ⚔️
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {tournaments.map(t => {
        const isSelected = t.id === selectedId;
        const statusColor = t.status === "draft" ? "#60a5fa" : t.status === "completed" ? "#facc15" : "#f87171";
        const statusLabel = t.status === "draft" ? "OPEN · " + t.participants.length + "/" + t.size
          : t.status === "completed" ? "CHAMPION CROWNED"
            : "LIVE · " + t.participants.filter(p => !p.eliminatedRound).length + " left";
        return (
          <div
            key={t.id}
            onClick={() => onSelect(t.id)}
            style={{
              cursor: "pointer", flex: "1 1 280px",
              background: isSelected ? "rgba(127,29,29,0.7)" : "rgba(15,23,42,0.85)",
              border: `2px solid ${isSelected ? "#facc15" : "rgba(148,163,184,0.35)"}`,
              borderRadius: 10, padding: "12px 16px",
              fontFamily: JP, transition: "all 0.2s ease",
              boxShadow: isSelected ? "0 0 20px rgba(250,204,21,0.4)" : "none",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: "white", marginBottom: 4, letterSpacing: 0.5 }}>{t.name}</div>
            <div style={{ display: "flex", gap: 12, fontSize: 11, alignItems: "center" }}>
              <span style={{ color: statusColor, fontWeight: 700, letterSpacing: 1 }}>{statusLabel}</span>
              <span style={{ color: "rgba(203,213,225,0.6)" }}>·</span>
              <span style={{ color: "rgba(203,213,225,0.7)" }}>Entry: {t.entryFee} REBEL</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Main page

export default function TournamentPage() {
  const [identity, setIdentity] = useState<IdentityShape>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = tournaments.find(t => t.id === selectedId) || null;

  useEffect(() => {
    const p = loadProfile();
    setIdentity(deriveIdentity(p));
  }, []);

  const fetchAll = async () => {
    try {
      const r = await fetch("/api/faction-wars/tournament/list");
      const j = await r.json();
      if (j.ok && Array.isArray(j.tournaments)) {
        setTournaments(j.tournaments);
        if (!selectedId && j.tournaments.length > 0) {
          setSelectedId(j.tournaments[0].id);
        }
      }
    } catch (e) {
      // swallow — non-fatal
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 4000);
    return () => clearInterval(interval);
  }, []);

  const onJoin = async () => {
    if (!selected || !identity) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/faction-wars/tournament/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tournamentId: selected.id,
          playerId: identity.playerId,
          displayName: identity.displayName,
        }),
      });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error || "Join failed");
      } else {
        await fetchAll();
      }
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setBusy(false);
    }
  };

  const onLeave = async () => {
    if (!selected || !identity) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/faction-wars/tournament/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentId: selected.id, playerId: identity.playerId }),
      });
      const j = await r.json();
      if (!j.ok) setError(j.error || "Leave failed");
      else await fetchAll();
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setBusy(false);
    }
  };

  const onWatchMatch = (challengeId: string) => {
    window.open(`/faction-wars/spectate/${challengeId}`, "_blank");
  };

  const isJoined = !!(selected && identity && selected.participants.some(p => p.playerId === identity.playerId));
  const canJoin = !!(selected && selected.status === "draft" && !isJoined && selected.participants.length < selected.size);

  return (
    <>
      <Head>
        <title>Tournaments — Rebel Ants Playground</title>
      </Head>

      <style jsx global>{`
        @keyframes liveBorderPulse {
          0%, 100% { box-shadow: 0 0 24px rgba(248,113,113,0.55), inset 0 0 12px rgba(248,113,113,0.2); }
          50% { box-shadow: 0 0 36px rgba(248,113,113,0.85), inset 0 0 20px rgba(248,113,113,0.35); }
        }
        @keyframes connPulse {
          0%, 100% { stroke-opacity: 0.7; }
          50% { stroke-opacity: 1; }
        }
        @keyframes champFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes champShimmer {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
      `}</style>

      <div style={{
        minHeight: "100vh",
        color: "white",
        paddingBottom: 60,
        fontFamily: JP,
        backgroundImage: "url('/bg/faction-wars-bg.png')",
        backgroundSize: "cover",
        backgroundPosition: "center top",
        backgroundAttachment: "fixed",
        backgroundRepeat: "no-repeat",
        position: "relative",
      }}>
        <div style={{ position: "fixed", inset: 0, background: "rgba(8,11,20,0.82)", zIndex: 0, pointerEvents: "none" }} />

        <div style={{ position: "relative", zIndex: 1 }}>
          {/* Header */}
          <header style={{
            maxWidth: 1240, margin: "0 auto", padding: "16px 20px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <Link href="/faction-wars" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "white" }}>
              <span style={{ fontSize: 24 }}>⚔️</span>
              <span style={{ fontWeight: 700, letterSpacing: 1.2, fontSize: 15 }}>FACTION WARS</span>
            </Link>
            <Link href="/faction-wars/pvp" style={{
              fontFamily: JP, fontSize: 13, color: "rgba(203,213,225,0.85)",
              textDecoration: "none", padding: "6px 12px",
              border: "1px solid rgba(148,163,184,0.4)", borderRadius: 6,
            }}>← PvP Lobby</Link>
          </header>

          {/* Title */}
          <div style={{ maxWidth: 1240, margin: "0 auto", padding: "20px 20px 0", textAlign: "center" }}>
            <h1 style={{
              fontSize: 42, margin: 0, letterSpacing: 3,
              background: "linear-gradient(135deg, #facc15 0%, #fb923c 50%, #f87171 100%)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              textShadow: "0 0 30px rgba(250,204,21,0.3)",
              fontWeight: 900,
            }}>TOURNAMENT</h1>
            <div style={{ fontSize: 12, color: "rgba(203,213,225,0.7)", letterSpacing: 2, marginTop: 4 }}>
              SINGLE-ELIMINATION · WINNER TAKES ALL · 5-TERRITORY MATCHES
            </div>
          </div>

          {/* Active tournaments selector */}
          <div style={{ maxWidth: 1240, margin: "0 auto", padding: "30px 20px 0" }}>
            <div style={{ fontSize: 13, color: "rgba(203,213,225,0.7)", letterSpacing: 2, marginBottom: 10, fontWeight: 600 }}>
              ACTIVE TOURNAMENTS
            </div>
            {loading
              ? <div style={{ color: "rgba(203,213,225,0.6)", fontFamily: JP, padding: 16 }}>Loading…</div>
              : <TournamentsList tournaments={tournaments} selectedId={selectedId} onSelect={setSelectedId} />}
          </div>

          {/* Selected tournament details + bracket */}
          {selected && (
            <>
              <ChampionBanner tournament={selected} />

              {/* Info bar */}
              <div style={{ maxWidth: 1240, margin: "30px auto 0", padding: "0 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div style={{ display: "flex", gap: 24, fontSize: 13, color: "rgba(203,213,225,0.85)" }}>
                  <div><span style={{ color: "rgba(203,213,225,0.55)" }}>Players:</span> <strong>{selected.participants.length}/{selected.size}</strong></div>
                  <div><span style={{ color: "rgba(203,213,225,0.55)" }}>Entry:</span> <strong>{selected.entryFee} REBEL</strong></div>
                  <div><span style={{ color: "rgba(203,213,225,0.55)" }}>Final pot:</span> <strong style={{ color: "#facc15" }}>{selected.potPerRound[selected.potPerRound.length - 1]} REBEL</strong></div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {!identity && selected.status === "draft" && (
                    <Link href="/faction-wars/pvp" style={{ textDecoration: "none" }}>
                      <div style={{
                        padding: "10px 18px",
                        background: "rgba(96, 165, 250, 0.18)",
                        border: "1px solid rgba(96, 165, 250, 0.5)",
                        borderRadius: 8,
                        color: "#93c5fd",
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: 1,
                        cursor: "pointer",
                      }}>
                        SIGN IN AT PVP LOBBY TO JOIN →
                      </div>
                    </Link>
                  )}
                  {canJoin && identity && (
                    <button onClick={onJoin} disabled={busy} style={{
                      background: "linear-gradient(135deg, #facc15 0%, #fb923c 100%)",
                      color: "#1f2937", border: "none", padding: "10px 22px", borderRadius: 8,
                      fontWeight: 800, fontSize: 14, cursor: busy ? "wait" : "pointer", letterSpacing: 1,
                      boxShadow: "0 4px 16px rgba(250,204,21,0.4)",
                    }}>{busy ? "JOINING…" : `JOIN · ${selected.entryFee} REBEL`}</button>
                  )}
                  {isJoined && selected.status === "draft" && (
                    <button onClick={onLeave} disabled={busy} style={{
                      background: "transparent", color: "rgba(248,113,113,0.9)",
                      border: "1px solid rgba(248,113,113,0.5)", padding: "10px 18px", borderRadius: 8,
                      fontSize: 13, cursor: busy ? "wait" : "pointer",
                    }}>Leave (refund)</button>
                  )}
                  {isJoined && selected.status !== "draft" && (
                    <div style={{ padding: "8px 14px", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.4)", borderRadius: 8, fontSize: 12, color: "#86efac", fontWeight: 600, letterSpacing: 1 }}>
                      ⚔️ YOU'RE IN
                    </div>
                  )}
                </div>
              </div>

              {error && (
                <div style={{ maxWidth: 1240, margin: "10px auto 0", padding: "0 20px" }}>
                  <div style={{ background: "rgba(127,29,29,0.4)", border: "1px solid rgba(248,113,113,0.5)", color: "#fecaca", padding: 10, borderRadius: 6, fontSize: 13 }}>{error}</div>
                </div>
              )}

              {/* Bracket */}
              {selected.rounds.length > 0 ? (
                <BracketView tournament={selected} onWatchMatch={onWatchMatch} />
              ) : (
                <div style={{ maxWidth: 1240, margin: "40px auto 0", padding: "0 20px", textAlign: "center" }}>
                  <div style={{
                    background: "rgba(15,23,42,0.7)", border: "1px dashed rgba(148,163,184,0.4)",
                    borderRadius: 10, padding: 40, color: "rgba(203,213,225,0.7)", fontSize: 14,
                  }}>
                    Bracket will appear once the tournament is seeded by an admin.
                    <div style={{ marginTop: 16, fontSize: 12, color: "rgba(203,213,225,0.5)" }}>
                      {selected.participants.length}/{selected.size} players have joined.
                    </div>
                  </div>
                </div>
              )}

              {/* Participants list */}
              {selected.participants.length > 0 && (
                <div style={{ maxWidth: 1240, margin: "30px auto 0", padding: "0 20px" }}>
                  <div style={{ fontSize: 13, color: "rgba(203,213,225,0.7)", letterSpacing: 2, marginBottom: 8, fontWeight: 600 }}>
                    PARTICIPANTS
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {selected.participants.map(p => {
                      const eliminated = p.eliminatedRound !== null;
                      const isChamp = selected.championPlayerId === p.playerId;
                      return (
                        <div key={p.playerId} style={{
                          padding: "5px 10px", borderRadius: 16,
                          background: isChamp ? "rgba(250,204,21,0.2)" : eliminated ? "rgba(15,23,42,0.6)" : "rgba(34,197,94,0.15)",
                          border: `1px solid ${isChamp ? "#facc15" : eliminated ? "rgba(148,163,184,0.3)" : "rgba(34,197,94,0.4)"}`,
                          fontSize: 12,
                          color: isChamp ? "#facc15" : eliminated ? "rgba(148,163,184,0.5)" : "white",
                          textDecoration: eliminated && !isChamp ? "line-through" : "none",
                        }}>
                          {isChamp && "👑 "}
                          {p.displayName}
                          {eliminated && !isChamp && ` · OUT R${(p.eliminatedRound || 0) + 1}`}
                        </div>
                      );
                    })}
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
