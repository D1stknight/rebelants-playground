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
import type { PvpMatch, PvpRound, PvpBet, PvpBetsState, PvpSide, ChatMessage, ChatMute, ChatRole } from "../../../lib/types/fwpvp";
import { loadProfile, type Profile } from "../../../lib/profile";

const JP =
  '"Noto Serif JP", "Hiragino Mincho ProN", serif';

function makeViewerKey(): string {
  // Per-tab random id. Not persisted; two tabs are two viewers, fine for V1.
  if (typeof window === "undefined") return "ssr";
  const r = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36);
  return `${t}-${r}`;
}

// Mirror of pvp.tsx deriveIdentity. Spectate page allows anonymous viewing
// (no identity required to watch), but identity IS required to bet — the
// betting panel renders a sign-in nudge if identity is null.
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

export default function SpectatePage() {
  const router = useRouter();
  const challengeId = String(router.query.challengeId || "");
  const [match, setMatch] = useState<PvpMatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState<number | null>(null);
  // Identity for placing bets. Loaded from profile on mount.
  const [identity, setIdentity] = useState<{ playerId: string; displayName: string } | null>(null);
  // Bet config (admin-overridable). Defaults match server values.
  const [betEnabled, setBetEnabled] = useState<boolean>(true);
  const [betMin, setBetMin] = useState<number>(50);
  const [betMax, setBetMax] = useState<number>(25000);
  const [betPoolCap, setBetPoolCap] = useState<number>(100000);
  const [betLockTerritory, setBetLockTerritory] = useState<number>(3);
  const [featuredMatchId, setFeaturedMatchId] = useState<string | null>(null);
  // Bet state for this match — polled every 5s.
  const [betsState, setBetsState] = useState<PvpBetsState | null>(null);
  // ── Chat state (Layer 2D) ──────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatEnabled, setChatEnabled] = useState<boolean>(true);
  const [myMute, setMyMute] = useState<ChatMute | null>(null);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatPosting, setChatPosting] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string | null>(null);
  // Admin detection — read sessionStorage on mount. If ra_admin_token is set,
  // user is treated as admin in this session. Token sent with every admin
  // request as x-admin-key header.
  const [adminToken, setAdminToken] = useState<string>("");
  // Admin moderation toggle — when true, trash/mute icons render on hover.
  // Lets admins switch between "casual viewer" and "active mod" modes.
  const [adminModeOn, setAdminModeOn] = useState<boolean>(true);
  // Tracks which message has been "armed" for delete (1-second confirm pattern).
  // After first click, message id stored here for ~1s; second click within
  // window deletes. Resets on timeout.
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const armedDeleteTimerRef = useRef<any>(null);
  // Mute popover: which message's mute icon is currently expanded
  const [openMutePopoverFor, setOpenMutePopoverFor] = useState<string | null>(null);
  // Admin "Muted: N" panel state
  const [showMutesPanel, setShowMutesPanel] = useState<boolean>(false);
  const [mutesList, setMutesList] = useState<ChatMute[]>([]);
  // Player REBEL balance for the bet form. Refreshed after each placed bet.
  const [balance, setBalance] = useState<number | null>(null);
  // Bet form state.
  const [betSide, setBetSide] = useState<PvpSide | null>(null);
  const [betAmount, setBetAmount] = useState<string>("");
  const [betSubmitting, setBetSubmitting] = useState<boolean>(false);
  const [betError, setBetError] = useState<string | null>(null);
  const [betSuccess, setBetSuccess] = useState<string | null>(null);
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

  // ── Identity load (one-shot) ──────────────────────────────────────────────
  // Required for placing bets. Anonymous viewers can still watch.
  useEffect(() => {
    const p = loadProfile();
    setIdentity(deriveIdentity(p));
  }, []);

  // ── Bet config + featuredMatchId + balance load ──────────────────────────
  // We refetch balance each time we successfully place a bet (handlePlaceBet),
  // but the initial load happens here.
  useEffect(() => {
    let cancelled = false;
    const loadCfg = async () => {
      try {
        const cfgRes = await fetch("/api/config").then((r) => r.json());
        if (cancelled) return;
        if (cfgRes?.ok && cfgRes.pointsConfig) {
          const c = cfgRes.pointsConfig;
          if (c.factionWarsBetEnabled === false) setBetEnabled(false);
          else setBetEnabled(true);
          const bMin = Number(c.factionWarsBetMin);
          const bMax = Number(c.factionWarsBetMax);
          const bCap = Number(c.factionWarsBetPoolCap);
          const bLock = Number(c.factionWarsBetLockTerritory);
          if (Number.isFinite(bMin) && bMin >= 0) setBetMin(bMin);
          if (Number.isFinite(bMax) && bMax >= 0) setBetMax(bMax);
          if (Number.isFinite(bCap) && bCap >= 0) setBetPoolCap(bCap);
          if (Number.isFinite(bLock) && bLock >= 1 && bLock <= 5) setBetLockTerritory(bLock);
          const fmid = c.featuredMatchId;
          setFeaturedMatchId(typeof fmid === "string" && fmid.trim().length > 0 ? fmid.trim() : null);
        }
      } catch {}
    };
    loadCfg();
    return () => { cancelled = true; };
  }, []);

  // ── Balance load (only when identity available) ───────────────────────────
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    const loadBal = async () => {
      try {
        const r = await fetch(`/api/points/balance?playerId=${encodeURIComponent(identity.playerId)}`);
        const j = await r.json();
        if (!cancelled && j && typeof j.balance === "number") {
          setBalance(Number(j.balance));
        }
      } catch {}
    };
    loadBal();
    return () => { cancelled = true; };
  }, [identity]);

  // ── Bets state polling (every 5s) ─────────────────────────────────────────
  useEffect(() => {
    if (!challengeId) return;
    let cancelled = false;
    let timer: any = null;
    const tick = async () => {
      if (cancelled) return;
      try {
        const r = await fetch(`/api/faction-wars/pvp/bets?id=${encodeURIComponent(challengeId)}`);
        const j = await r.json();
        if (!cancelled && j?.ok && j.bets) {
          setBetsState(j.bets as PvpBetsState);
        }
      } catch {}
      finally { if (!cancelled) timer = setTimeout(tick, 5000); }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [challengeId]);

  // ── Bet placement handler ────────────────────────────────────────────────
  const handlePlaceBet = async () => {
    if (!identity || !match || !betSide) return;
    const amt = Math.floor(Number(betAmount));
    if (!Number.isFinite(amt) || amt <= 0) {
      setBetError("Enter a valid amount");
      return;
    }
    setBetSubmitting(true);
    setBetError(null);
    setBetSuccess(null);
    try {
      const r = await fetch("/api/faction-wars/pvp/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId,
          playerId: identity.playerId,
          displayName: identity.displayName,
          side: betSide,
          amount: amt,
        }),
      });
      const j = await r.json();
      if (!j.ok) {
        setBetError(j.error || "Bet failed");
        return;
      }
      setBetSuccess(`✓ Bet ${amt.toLocaleString()} REBEL on ${betSide}`);
      setBetAmount("");
      if (typeof j.newBalance === "number") setBalance(j.newBalance);
      if (j.bets) setBetsState(j.bets as PvpBetsState);
      setTimeout(() => setBetSuccess(null), 3500);
    } catch (e: any) {
      setBetError(e?.message || "Network error");
    } finally {
      setBetSubmitting(false);
    }
  };

  // ── Chat: load admin token from sessionStorage on mount ───────────────────
  // Admins go to /admin and enter their token, which sessionStorage["ra_admin_token"]
  // captures. We mirror that here so admin moderation tools light up automatically
  // on the spectate page without requiring a re-auth.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const t = sessionStorage.getItem("ra_admin_token") || "";
      if (t) setAdminToken(t);
    } catch {}
  }, []);

  const isAdmin = !!adminToken;

  // ── Chat: poll messages every 2s ──────────────────────────────────────────
  useEffect(() => {
    if (!challengeId) return;
    let cancelled = false;
    let timer: any = null;
    const tick = async () => {
      if (cancelled || stoppedRef.current) return;
      try {
        const url = identity
          ? `/api/faction-wars/pvp/chat/messages?id=${encodeURIComponent(challengeId)}&playerId=${encodeURIComponent(identity.playerId)}`
          : `/api/faction-wars/pvp/chat/messages?id=${encodeURIComponent(challengeId)}`;
        const r = await fetch(url);
        const j = await r.json();
        if (cancelled) return;
        if (j?.ok) {
          if (Array.isArray(j.messages)) setChatMessages(j.messages as ChatMessage[]);
          if (typeof j.enabled === "boolean") setChatEnabled(j.enabled);
          setMyMute(j.myMute ?? null);
        }
      } catch {}
      finally { if (!cancelled) timer = setTimeout(tick, 2000); }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [challengeId, identity]);

  // ── Chat: post a message ──────────────────────────────────────────────────
  const handlePostChat = async () => {
    if (!identity || !chatInput.trim() || chatPosting) return;
    setChatPosting(true);
    setChatError(null);
    try {
      const r = await fetch("/api/faction-wars/pvp/chat/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId,
          playerId: identity.playerId,
          displayName: identity.displayName,
          text: chatInput.trim(),
        }),
      });
      const j = await r.json();
      if (!j.ok) {
        // If muted, surface the mute info explicitly so the banner appears
        // immediately rather than waiting for the next poll.
        if (j.mute) setMyMute(j.mute as ChatMute);
        setChatError(j.error || "Failed to post");
        return;
      }
      // Optimistic append — next poll will reconcile.
      if (j.message) setChatMessages((prev) => [...prev, j.message as ChatMessage]);
      setChatInput("");
      // Auto-clear error if any from a previous attempt
      setChatError(null);
    } catch (e: any) {
      setChatError(e?.message || "Network error");
    } finally {
      setChatPosting(false);
    }
  };

  // ── Chat: admin actions (delete, mute, unmute, clear-all, list mutes) ────
  // All admin requests include x-admin-key header. Server validates against
  // ADMIN_KEY env var.

  const adminFetch = async (url: string, body?: any): Promise<any> => {
    const headers: Record<string, string> = {
      "x-admin-key": adminToken,
      "x-admin-token": adminToken,
    };
    if (body) headers["Content-Type"] = "application/json";
    const r = await fetch(url, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  };

  // Delete a message — uses 1-second confirmation pattern. First click "arms"
  // the message; second click within 1s deletes. Anti-fat-finger on mobile.
  const handleDeleteMessage = async (messageId: string) => {
    if (!adminToken) return;
    if (armedDeleteId !== messageId) {
      // First click — arm.
      setArmedDeleteId(messageId);
      if (armedDeleteTimerRef.current) clearTimeout(armedDeleteTimerRef.current);
      armedDeleteTimerRef.current = setTimeout(() => setArmedDeleteId(null), 1000);
      return;
    }
    // Second click within 1s — delete.
    if (armedDeleteTimerRef.current) clearTimeout(armedDeleteTimerRef.current);
    setArmedDeleteId(null);
    // Optimistic: remove from local state immediately
    setChatMessages((prev) => prev.filter((m) => m.id !== messageId));
    try {
      await adminFetch("/api/faction-wars/pvp/chat/delete", { challengeId, messageId });
    } catch {}
  };

  const handleMuteUser = async (playerId: string, displayName: string, durationMs: number) => {
    if (!adminToken) return;
    setOpenMutePopoverFor(null);
    try {
      await adminFetch("/api/faction-wars/pvp/chat/mute", {
        challengeId,
        playerId,
        displayName,
        durationMs,
      });
      // Refresh mutes list if open
      if (showMutesPanel) refreshMutes();
    } catch {}
  };

  const handleUnmuteUser = async (playerId: string) => {
    if (!adminToken) return;
    try {
      await adminFetch("/api/faction-wars/pvp/chat/unmute", { challengeId, playerId });
      setMutesList((prev) => prev.filter((m) => m.playerId !== playerId));
    } catch {}
  };

  const refreshMutes = async () => {
    if (!adminToken) return;
    try {
      const j = await adminFetch(`/api/faction-wars/pvp/chat/mutes?id=${encodeURIComponent(challengeId)}`);
      if (j?.ok && Array.isArray(j.mutes)) setMutesList(j.mutes as ChatMute[]);
    } catch {}
  };

  const handleClearAllChat = async () => {
    if (!adminToken) return;
    if (!confirm("Wipe ALL chat messages for this match? This cannot be undone.")) return;
    setChatMessages([]);
    try {
      await adminFetch("/api/faction-wars/pvp/chat/clear", { challengeId });
    } catch {}
  };

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
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {featuredMatchId === challengeId && (
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.15em", textTransform: "uppercase", color: "#fbbf24", padding: "4px 10px", borderRadius: 12, background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.4)" }}>
                ⭐ FEATURED
              </div>
            )}
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
            {balance !== null && identity && (
              <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.05em", color: "#fbbf24", padding: "4px 10px", borderRadius: 12, background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.25)" }}>
                ⚡ {balance.toLocaleString()} <span style={{ fontSize: 10, color: "rgba(251,191,36,0.6)", fontWeight: 700 }}>REBEL</span>
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

              {/* Side bets panel (Layer 2B) */}
              <BetPanel
                match={match}
                betsState={betsState}
                identity={identity}
                balance={balance}
                betEnabled={betEnabled}
                betMin={betMin}
                betMax={betMax}
                betPoolCap={betPoolCap}
                betLockTerritory={betLockTerritory}
                betSide={betSide}
                setBetSide={setBetSide}
                betAmount={betAmount}
                setBetAmount={setBetAmount}
                betSubmitting={betSubmitting}
                betError={betError}
                betSuccess={betSuccess}
                onPlaceBet={handlePlaceBet}
                isOver={isOver}
              />

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

              {/* Chat panel (Layer 2D) */}
              {chatEnabled && (
                <div style={{ marginTop: 20 }}>
                  <ChatPanel
                    match={match}
                    identity={identity}
                    messages={chatMessages}
                    myMute={myMute}
                    chatInput={chatInput}
                    setChatInput={setChatInput}
                    chatPosting={chatPosting}
                    chatError={chatError}
                    onPost={handlePostChat}
                    isAdmin={isAdmin}
                    adminModeOn={adminModeOn}
                    setAdminModeOn={setAdminModeOn}
                    armedDeleteId={armedDeleteId}
                    onDelete={handleDeleteMessage}
                    openMutePopoverFor={openMutePopoverFor}
                    setOpenMutePopoverFor={setOpenMutePopoverFor}
                    onMute={handleMuteUser}
                    showMutesPanel={showMutesPanel}
                    setShowMutesPanel={setShowMutesPanel}
                    mutesList={mutesList}
                    refreshMutes={refreshMutes}
                    onUnmute={handleUnmuteUser}
                    onClearAll={handleClearAllChat}
                  />
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

function BetPanel({
  match, betsState, identity, balance,
  betEnabled, betMin, betMax, betPoolCap, betLockTerritory,
  betSide, setBetSide, betAmount, setBetAmount,
  betSubmitting, betError, betSuccess, onPlaceBet, isOver,
}: {
  match: PvpMatch;
  betsState: PvpBetsState | null;
  identity: { playerId: string; displayName: string } | null;
  balance: number | null;
  betEnabled: boolean;
  betMin: number;
  betMax: number;
  betPoolCap: number;
  betLockTerritory: number;
  betSide: PvpSide | null;
  setBetSide: (s: PvpSide | null) => void;
  betAmount: string;
  setBetAmount: (s: string) => void;
  betSubmitting: boolean;
  betError: string | null;
  betSuccess: string | null;
  onPlaceBet: () => void;
  isOver: boolean;
}) {
  // Compute bet panel state. We render a different view in each phase:
  //   - betting open: form + pools + recent bettors
  //   - locked but match in progress: pools + recent bettors, no form
  //   - completed: payout summary
  //   - participant: hidden
  if (!betEnabled) return null;

  const isParticipant = !!identity && (identity.playerId === match.challengerPlayerId || identity.playerId === match.opponentPlayerId);
  const lockIdx = Math.max(1, Math.min(TERRITORY_COUNT, betLockTerritory)) - 1;
  const matchPastLock = match.currentTerritory >= lockIdx;
  const matchTerminal = match.status === "completed" || match.status === "cancelled";
  const locked = (betsState?.locked ?? false) || matchPastLock || matchTerminal;
  const myBet = betsState?.bets.find((b) => identity && b.playerId === identity.playerId) ?? null;

  const challengerPool = betsState?.challengerPool ?? 0;
  const opponentPool = betsState?.opponentPool ?? 0;
  const totalPool = challengerPool + opponentPool;
  // Pari-mutuel implied multiplier (returned amount per 1 staked, INCLUDING stake).
  // multiplier_C = (loserPool + winnerPool) / winnerPool, when winnerPool > 0.
  // We surface as "Xx return" — easier to read than odds.
  const challengerMult = challengerPool > 0 ? totalPool / challengerPool : null;
  const opponentMult = opponentPool > 0 ? totalPool / opponentPool : null;

  if (isParticipant) {
    return (
      <div style={{ padding: "16px 20px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)", marginBottom: 20, fontSize: 12, color: "rgba(255,255,255,0.5)", textAlign: "center" }}>
        Side bets are open to spectators only — you can't bet on your own match.
      </div>
    );
  }

  // Completed match payout summary
  if (match.status === "completed" && betsState && betsState.bets.length > 0) {
    const winnerSide: PvpSide = match.winnerPlayerId === match.challengerPlayerId ? "challenger" : "opponent";
    const winnerBets = betsState.bets.filter((b) => b.side === winnerSide);
    const loserBets = betsState.bets.filter((b) => b.side !== winnerSide);
    const winnerPool = winnerBets.reduce((a, b) => a + b.amount, 0);
    const loserPool = loserBets.reduce((a, b) => a + b.amount, 0);
    return (
      <div style={{ padding: "20px 22px", borderRadius: 14, border: "1px solid rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.04)", marginBottom: 20 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#fbbf24", marginBottom: 12 }}>
          Bets Settled
        </div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.85)", marginBottom: 10 }}>
          {winnerBets.length > 0
            ? `${winnerBets.length} bettor${winnerBets.length === 1 ? "" : "s"} on ${winnerSide} took the ${loserPool.toLocaleString()} REBEL loser pool.`
            : `No ${winnerSide} bettors — ${loserPool.toLocaleString()} REBEL refunded to losers.`}
        </div>
        {myBet && (
          <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,0.3)", fontSize: 12 }}>
            {myBet.side === winnerSide
              ? winnerPool > 0
                ? <><span style={{ color: "#34d399", fontWeight: 900 }}>You won!</span> <span style={{ color: "rgba(255,255,255,0.7)" }}>Bet {myBet.amount.toLocaleString()} on {myBet.side} → received {(myBet.amount + Math.floor((myBet.amount / winnerPool) * loserPool)).toLocaleString()} REBEL.</span></>
                : <span style={{ color: "rgba(255,255,255,0.7)" }}>Refunded {myBet.amount.toLocaleString()} REBEL.</span>
              : <><span style={{ color: "#f87171", fontWeight: 900 }}>You lost.</span> <span style={{ color: "rgba(255,255,255,0.7)" }}>Bet {myBet.amount.toLocaleString()} on {myBet.side}.</span></>}
          </div>
        )}
      </div>
    );
  }

  if (match.status === "cancelled" && betsState && betsState.bets.length > 0) {
    return (
      <div style={{ padding: "16px 20px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)", marginBottom: 20, fontSize: 12, color: "rgba(255,255,255,0.6)", textAlign: "center" }}>
        Match cancelled — all bets refunded.
      </div>
    );
  }

  // Active or pending match — show pools + form
  return (
    <div style={{ padding: "20px 22px", borderRadius: 14, border: "1px solid rgba(251,191,36,0.25)", background: "rgba(251,191,36,0.02)", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#fbbf24" }}>
          Side Bets {locked && <span style={{ color: "#f87171", marginLeft: 6 }}>· LOCKED</span>}
        </div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>
          Bets close at start of T{betLockTerritory} · Pari-mutuel
        </div>
      </div>

      {/* Pool summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: locked ? 0 : 16 }}>
        <PoolCard side="challenger" name={match.challengerDisplayName} accent="#fbbf24" pool={challengerPool} mult={challengerMult} bettors={betsState?.challengerBettorCount ?? 0} />
        <PoolCard side="opponent" name={match.opponentDisplayName ?? "—"} accent="#a5b4fc" pool={opponentPool} mult={opponentMult} bettors={betsState?.opponentBettorCount ?? 0} />
      </div>

      {/* Bet form (only when not locked and not a participant) */}
      {!locked && !isOver && (
        <>
          {!identity ? (
            <div style={{ padding: 12, borderRadius: 8, border: "1px dashed rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.02)", textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
              <a href="/" style={{ color: "#fbbf24", textDecoration: "underline" }}>Sign in</a> to place a bet
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>
                {myBet ? `Top up your bet on ${myBet.side}` : "Place a bet"}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                <button
                  onClick={() => setBetSide("challenger")}
                  disabled={betSubmitting || (myBet ? myBet.side !== "challenger" : false)}
                  style={{
                    flex: "1 1 140px",
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: `1px solid ${betSide === "challenger" ? "rgba(251,191,36,0.7)" : "rgba(255,255,255,0.15)"}`,
                    background: betSide === "challenger" ? "rgba(251,191,36,0.15)" : "rgba(255,255,255,0.03)",
                    color: betSide === "challenger" ? "#fbbf24" : "rgba(255,255,255,0.7)",
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.05em",
                    cursor: betSubmitting ? "wait" : "pointer",
                    opacity: myBet && myBet.side !== "challenger" ? 0.4 : 1,
                  }}
                >
                  Bet on {match.challengerDisplayName}
                </button>
                <button
                  onClick={() => setBetSide("opponent")}
                  disabled={betSubmitting || (myBet ? myBet.side !== "opponent" : false)}
                  style={{
                    flex: "1 1 140px",
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: `1px solid ${betSide === "opponent" ? "rgba(165,180,252,0.7)" : "rgba(255,255,255,0.15)"}`,
                    background: betSide === "opponent" ? "rgba(165,180,252,0.15)" : "rgba(255,255,255,0.03)",
                    color: betSide === "opponent" ? "#a5b4fc" : "rgba(255,255,255,0.7)",
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.05em",
                    cursor: betSubmitting ? "wait" : "pointer",
                    opacity: myBet && myBet.side !== "opponent" ? 0.4 : 1,
                  }}
                >
                  Bet on {match.opponentDisplayName ?? "Opponent"}
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  inputMode="numeric"
                  min={betMin}
                  max={betMax}
                  step={1}
                  placeholder={`Min ${betMin} · Max ${betMax.toLocaleString()}`}
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  disabled={betSubmitting}
                  style={{
                    flex: "1 1 180px",
                    minHeight: 40,
                    padding: "0 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(0,0,0,0.3)",
                    color: "white",
                    fontSize: 13,
                    fontFamily: "inherit",
                  }}
                />
                <button
                  onClick={onPlaceBet}
                  disabled={betSubmitting || !betSide || !betAmount}
                  style={{
                    minWidth: 140,
                    height: 40,
                    padding: "0 18px",
                    borderRadius: 20,
                    border: "1px solid rgba(251,191,36,0.5)",
                    background: betSubmitting || !betSide || !betAmount ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,rgba(251,191,36,0.3),rgba(248,113,113,0.25))",
                    color: betSubmitting || !betSide || !betAmount ? "rgba(255,255,255,0.4)" : "#fbbf24",
                    fontSize: 12,
                    fontWeight: 900,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    cursor: betSubmitting ? "wait" : (!betSide || !betAmount) ? "not-allowed" : "pointer",
                  }}
                >
                  {betSubmitting ? "Placing…" : "💰 Place Bet"}
                </button>
              </div>
              {betError && <div style={{ marginTop: 10, fontSize: 12, color: "#f87171" }}>{betError}</div>}
              {betSuccess && <div style={{ marginTop: 10, fontSize: 12, color: "#34d399" }}>{betSuccess}</div>}
              {myBet && (
                <div style={{ marginTop: 10, fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
                  Your current bet: <span style={{ color: myBet.side === "challenger" ? "#fbbf24" : "#a5b4fc", fontWeight: 700 }}>{myBet.amount.toLocaleString()} REBEL on {myBet.side}</span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Recent bettors feed */}
      {betsState && betsState.bets.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: 8 }}>
            Recent Bets
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {betsState.bets.slice(0, 5).map((b) => (
              <div key={b.playerId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
                <span style={{ color: "white", fontWeight: 700 }}>{b.displayName || "Anonymous"}</span>
                <span style={{ color: "rgba(255,255,255,0.45)" }}>bet</span>
                <span style={{ color: "white", fontWeight: 900 }}>{b.amount.toLocaleString()}</span>
                <span style={{ color: "rgba(255,255,255,0.45)" }}>on</span>
                <span style={{ color: b.side === "challenger" ? "#fbbf24" : "#a5b4fc", fontWeight: 700 }}>{b.side === "challenger" ? match.challengerDisplayName : (match.opponentDisplayName ?? "Opponent")}</span>
              </div>
            ))}
            {betsState.bets.length > 5 && (
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textAlign: "center", marginTop: 4 }}>
                +{betsState.bets.length - 5} more
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PoolCard({ side, name, accent, pool, mult, bettors }: { side: "challenger" | "opponent"; name: string; accent: string; pool: number; mult: number | null; bettors: number }) {
  return (
    <div style={{ padding: 14, borderRadius: 10, background: `rgba(255,255,255,0.02)`, border: `1px solid ${accent}33` }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)" }}>{side}</div>
      <div style={{ fontSize: 14, fontWeight: 900, color: accent, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 8 }}>
        <span style={{ fontSize: 18, fontWeight: 900, color: "white" }}>{pool.toLocaleString()}</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontWeight: 700 }}>REBEL</span>
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
        {bettors} bettor{bettors === 1 ? "" : "s"}
        {mult !== null && pool > 0 && (
          <> · <span style={{ color: accent, fontWeight: 700 }}>{mult.toFixed(2)}x</span> if win</>
        )}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// ChatPanel (Layer 2D)
// ─────────────────────────────────────────────────────────────────────────────
//
// Per-match chat. Anyone can read; sign-in required to post. Admins see
// hover trash + mute icons on each message. The "1-second click to confirm"
// pattern on delete prevents fat-finger disasters during streams.
//
// Player highlighting: challenger -> gold (#fbbf24), opponent -> blue (#a5b4fc),
// spectator -> white. Computed server-side at post time so it's stable.

function formatChatTime(at: number): string {
  const d = new Date(at);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m < 10 ? "0" + m : m}${ampm}`;
}

function formatMuteUntil(expireAt: number): string {
  const ms = expireAt - Date.now();
  if (ms <= 0) return "ended";
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function ChatPanel({
  match, identity, messages, myMute,
  chatInput, setChatInput, chatPosting, chatError, onPost,
  isAdmin, adminModeOn, setAdminModeOn,
  armedDeleteId, onDelete,
  openMutePopoverFor, setOpenMutePopoverFor, onMute,
  showMutesPanel, setShowMutesPanel, mutesList, refreshMutes,
  onUnmute, onClearAll,
}: {
  match: PvpMatch;
  identity: { playerId: string; displayName: string } | null;
  messages: ChatMessage[];
  myMute: ChatMute | null;
  chatInput: string;
  setChatInput: (s: string) => void;
  chatPosting: boolean;
  chatError: string | null;
  onPost: () => void;
  isAdmin: boolean;
  adminModeOn: boolean;
  setAdminModeOn: (b: boolean) => void;
  armedDeleteId: string | null;
  onDelete: (id: string) => void;
  openMutePopoverFor: string | null;
  setOpenMutePopoverFor: (id: string | null) => void;
  onMute: (playerId: string, displayName: string, durationMs: number) => void;
  showMutesPanel: boolean;
  setShowMutesPanel: (b: boolean) => void;
  mutesList: ChatMute[];
  refreshMutes: () => void;
  onUnmute: (playerId: string) => void;
  onClearAll: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Auto-scroll to bottom on new messages, but only if user was already near
  // the bottom (so reading scrollback isn't yanked away).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  const muted = myMute && myMute.expireAt > Date.now();
  const remainingChars = 280 - chatInput.length;

  const colorForRole = (r: ChatRole): string => {
    if (r === "challenger") return "#fbbf24";
    if (r === "opponent") return "#a5b4fc";
    return "rgba(255,255,255,0.85)";
  };

  return (
    <div style={{
      padding: "20px 22px",
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.02)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>
          💬 Chat
          <span style={{ marginLeft: 8, fontSize: 9, color: "rgba(255,255,255,0.35)" }}>
            ({messages.length})
          </span>
        </div>
        {isAdmin && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <button
              onClick={() => setAdminModeOn(!adminModeOn)}
              style={{
                fontSize: 10,
                fontWeight: 900,
                letterSpacing: "0.15em",
                color: adminModeOn ? "#34d399" : "rgba(255,255,255,0.5)",
                padding: "4px 10px",
                borderRadius: 12,
                background: adminModeOn ? "rgba(52,211,153,0.1)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${adminModeOn ? "rgba(52,211,153,0.4)" : "rgba(255,255,255,0.1)"}`,
                cursor: "pointer",
              }}
              title="Toggle admin moderation tools"
            >
              🛡 ADMIN {adminModeOn ? "ON" : "OFF"}
            </button>
            <button
              onClick={() => {
                setShowMutesPanel(!showMutesPanel);
                if (!showMutesPanel) refreshMutes();
              }}
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "rgba(255,255,255,0.7)",
                padding: "4px 10px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                cursor: "pointer",
              }}
              title="Show currently muted players"
            >
              🔇 Muted: {mutesList.length}
            </button>
            <button
              onClick={onClearAll}
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "#f87171",
                padding: "4px 10px",
                borderRadius: 12,
                background: "rgba(248,113,113,0.05)",
                border: "1px solid rgba(248,113,113,0.3)",
                cursor: "pointer",
              }}
              title="Wipe entire chat"
            >
              🧹 Clear All
            </button>
          </div>
        )}
      </div>

      {/* Mutes admin panel (collapsible) */}
      {isAdmin && showMutesPanel && (
        <div style={{
          marginBottom: 12,
          padding: "10px 12px",
          borderRadius: 10,
          background: "rgba(248,113,113,0.04)",
          border: "1px dashed rgba(248,113,113,0.25)",
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(248,113,113,0.8)", marginBottom: 8 }}>
            Active Mutes
          </div>
          {mutesList.length === 0 ? (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontStyle: "italic" }}>
              No active mutes
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {mutesList.map((m) => (
                <div key={m.playerId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                  <span style={{ color: "white", fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.displayName || m.playerId}
                  </span>
                  <span style={{ color: "rgba(255,255,255,0.5)" }}>
                    {formatMuteUntil(m.expireAt)} left
                  </span>
                  <button
                    onClick={() => onUnmute(m.playerId)}
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#34d399",
                      padding: "3px 8px",
                      borderRadius: 8,
                      background: "rgba(52,211,153,0.08)",
                      border: "1px solid rgba(52,211,153,0.3)",
                      cursor: "pointer",
                    }}
                  >
                    Unmute
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Message list */}
      <div
        ref={scrollRef}
        style={{
          maxHeight: 320,
          overflowY: "auto",
          padding: "4px 0",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {messages.length === 0 ? (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontStyle: "italic", padding: "20px 8px", textAlign: "center" }}>
            No messages yet — be the first to talk trash.
          </div>
        ) : (
          messages.map((m) => (
            <ChatRow
              key={m.id}
              message={m}
              colorForRole={colorForRole}
              isAdmin={isAdmin}
              adminModeOn={adminModeOn}
              armedDelete={armedDeleteId === m.id}
              onDelete={() => onDelete(m.id)}
              isMutePopoverOpen={openMutePopoverFor === m.id}
              setMutePopoverOpen={(open: boolean) => setOpenMutePopoverFor(open ? m.id : null)}
              onMute={(durationMs: number) => onMute(m.playerId, m.displayName, durationMs)}
            />
          ))
        )}
      </div>

      {/* Compose box */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        {muted ? (
          <div style={{
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.3)",
            fontSize: 12,
            color: "#f87171",
            textAlign: "center",
          }}>
            🔇 You're muted in this match — {formatMuteUntil(myMute!.expireAt)} remaining
          </div>
        ) : !identity ? (
          <div style={{
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.03)",
            border: "1px dashed rgba(255,255,255,0.15)",
            fontSize: 12,
            color: "rgba(255,255,255,0.6)",
            textAlign: "center",
          }}>
            <a href="/" style={{ color: "#fbbf24", textDecoration: "underline" }}>Sign in</a> to chat
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value.slice(0, 280))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onPost();
                  }
                }}
                placeholder="Talk trash, support your fave, hype the play..."
                disabled={chatPosting}
                maxLength={280}
                style={{
                  flex: 1,
                  minHeight: 38,
                  padding: "0 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(0,0,0,0.3)",
                  color: "white",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              />
              <button
                onClick={onPost}
                disabled={chatPosting || !chatInput.trim()}
                style={{
                  minWidth: 80,
                  height: 38,
                  padding: "0 14px",
                  borderRadius: 10,
                  border: "1px solid rgba(251,191,36,0.4)",
                  background: chatPosting || !chatInput.trim() ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,rgba(251,191,36,0.25),rgba(248,113,113,0.2))",
                  color: chatPosting || !chatInput.trim() ? "rgba(255,255,255,0.4)" : "#fbbf24",
                  fontSize: 11,
                  fontWeight: 900,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  cursor: chatPosting ? "wait" : !chatInput.trim() ? "not-allowed" : "pointer",
                }}
              >
                {chatPosting ? "..." : "Send"}
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10 }}>
              <span style={{ color: chatError ? "#f87171" : "rgba(255,255,255,0.4)" }}>
                {chatError || "Press Enter to send"}
              </span>
              <span style={{ color: remainingChars < 30 ? "#f87171" : "rgba(255,255,255,0.4)" }}>
                {remainingChars}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatRow({
  message, colorForRole, isAdmin, adminModeOn,
  armedDelete, onDelete,
  isMutePopoverOpen, setMutePopoverOpen, onMute,
}: {
  message: ChatMessage;
  colorForRole: (r: ChatRole) => string;
  isAdmin: boolean;
  adminModeOn: boolean;
  armedDelete: boolean;
  onDelete: () => void;
  isMutePopoverOpen: boolean;
  setMutePopoverOpen: (b: boolean) => void;
  onMute: (durationMs: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const showAdminTools = isAdmin && adminModeOn;
  const showAdminIcons = showAdminTools && (hovered || armedDelete || isMutePopoverOpen);

  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "5px 8px",
        borderRadius: 6,
        background: hovered && showAdminTools ? "rgba(255,255,255,0.03)" : "transparent",
        fontSize: 13,
        lineHeight: 1.4,
        wordBreak: "break-word",
      }}
    >
      <span style={{ color: colorForRole(message.role), fontWeight: 700, flexShrink: 0 }}>
        {message.displayName || "Anonymous"}
      </span>
      <span style={{ color: "rgba(255,255,255,0.85)", flex: 1 }}>
        {message.text}
      </span>
      <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 10, flexShrink: 0, marginTop: 2 }}>
        {formatChatTime(message.at)}
      </span>
      {showAdminIcons && (
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0, marginLeft: 4 }}>
          <button
            onClick={onDelete}
            title={armedDelete ? "Click again to confirm delete" : "Delete message"}
            style={{
              width: 24,
              height: 24,
              padding: 0,
              borderRadius: 6,
              border: armedDelete ? "1px solid rgba(248,113,113,0.7)" : "1px solid rgba(248,113,113,0.25)",
              background: armedDelete ? "rgba(248,113,113,0.2)" : "rgba(248,113,113,0.06)",
              color: "#f87171",
              fontSize: 11,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {armedDelete ? "?" : "🗑"}
          </button>
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setMutePopoverOpen(!isMutePopoverOpen)}
              title="Mute this player"
              style={{
                width: 24,
                height: 24,
                padding: 0,
                borderRadius: 6,
                border: "1px solid rgba(251,191,36,0.25)",
                background: "rgba(251,191,36,0.06)",
                color: "#fbbf24",
                fontSize: 11,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              🔇
            </button>
            {isMutePopoverOpen && (
              <div style={{
                position: "absolute",
                top: -42,
                right: 0,
                display: "flex",
                gap: 4,
                padding: 4,
                borderRadius: 8,
                background: "rgba(20,20,30,0.98)",
                border: "1px solid rgba(255,255,255,0.15)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                zIndex: 10,
              }}>
                <button
                  onClick={() => onMute(HOUR)}
                  style={muteBtnStyle()}
                >1h</button>
                <button
                  onClick={() => onMute(24 * HOUR)}
                  style={muteBtnStyle()}
                >24h</button>
                <button
                  onClick={() => onMute(7 * DAY)}
                  style={muteBtnStyle()}
                >7d</button>
                <button
                  onClick={() => setMutePopoverOpen(false)}
                  style={{ ...muteBtnStyle(), color: "rgba(255,255,255,0.5)" }}
                >✕</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function muteBtnStyle() {
  return {
    minWidth: 32,
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid rgba(251,191,36,0.3)",
    background: "rgba(251,191,36,0.08)",
    color: "#fbbf24",
    fontSize: 10,
    fontWeight: 800,
    cursor: "pointer" as const,
  };
}
