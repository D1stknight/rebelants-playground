// components/PvpChatPanel.tsx
//
// Shared per-match chat UI + state hook used by:
//   - pages/faction-wars/spectate/[challengeId].tsx (inline panel below Recent Action)
//   - pages/faction-wars/challenge/[challengeId].tsx (floating bottom-right drawer)
//
// Both pages render the SAME ChatPanel UI keyed off the same Redis chat list,
// so players in their match and spectators on the spectate page see the
// identical conversation in real time.
//
// Admin moderation tools are gated behind a 🐜 button. Clicking the ant
// prompts for the admin password (the same ADMIN_KEY env var that
// /api/admin/config validates against) on the first session click; subsequent
// clicks within the session use the cached value via sessionStorage["ra_admin_token"].
// The actual security comes from the server-side x-admin-key header check,
// not from the password prompt — the prompt is just a UX gate so non-admins
// don't see admin UI.

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { ChatMessage, ChatMute, ChatRole, PvpMatch } from "../lib/types/fwpvp";

// Module-level admin token cache — shared across ChatPanel instances on the
// same page (e.g. if both spectate-style and drawer-style render at once).
function readStoredAdminToken(): string {
  if (typeof window === "undefined") return "";
  try { return sessionStorage.getItem("ra_admin_token") || ""; } catch { return ""; }
}

// ─── useChatState ───────────────────────────────────────────────────────────
// Bundles all the polling + post + mute + admin actions. Both pages call
// this hook with the same args and pass the returned bag to <ChatPanel>.
export function useChatState(opts: {
  challengeId: string;
  identity: { playerId: string; displayName: string } | null;
  // When the page tab is hidden, polling pauses to save Upstash reads.
  pollPaused?: boolean;
}) {
  const { challengeId, identity, pollPaused } = opts;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [myMute, setMyMute] = useState<ChatMute | null>(null);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatPosting, setChatPosting] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // Admin state — token loaded lazily on first 🐜 click. `unlocked` drives
  // whether the admin dropdown is rendered in expanded form.
  const [adminToken, setAdminToken] = useState<string>("");
  const [adminModeOn, setAdminModeOn] = useState<boolean>(true);
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const armedDeleteTimerRef = useRef<any>(null);
  const [openMutePopoverFor, setOpenMutePopoverFor] = useState<string | null>(null);
  const [showMutesPanel, setShowMutesPanel] = useState<boolean>(false);
  const [mutesList, setMutesList] = useState<ChatMute[]>([]);

  // Track tab visibility so we don't burn Redis reads when the user is away.
  const visibilityRef = useRef<boolean>(typeof document === "undefined" ? true : document.visibilityState === "visible");
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => { visibilityRef.current = document.visibilityState === "visible"; };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Restore admin token from sessionStorage on mount (so a logged-in admin
  // who refreshes doesn't have to re-enter the password).
  useEffect(() => {
    const t = readStoredAdminToken();
    if (t) setAdminToken(t);
  }, []);

  const isAdmin = !!adminToken;

  // ── Polling ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!challengeId) return;
    let cancelled = false;
    let timer: any = null;
    const tick = async () => {
      if (cancelled) return;
      // Skip a tick when paused or tab hidden, but keep the timer alive.
      if (pollPaused || !visibilityRef.current) {
        timer = setTimeout(tick, 2000);
        return;
      }
      try {
        const url = identity
          ? `/api/faction-wars/pvp/chat/messages?id=${encodeURIComponent(challengeId)}&playerId=${encodeURIComponent(identity.playerId)}`
          : `/api/faction-wars/pvp/chat/messages?id=${encodeURIComponent(challengeId)}`;
        const r = await fetch(url);
        const j = await r.json();
        if (cancelled) return;
        if (j?.ok) {
          if (Array.isArray(j.messages)) setMessages(j.messages as ChatMessage[]);
          if (typeof j.enabled === "boolean") setEnabled(j.enabled);
          setMyMute(j.myMute ?? null);
        }
      } catch {}
      finally { if (!cancelled) timer = setTimeout(tick, 2000); }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [challengeId, identity?.playerId, pollPaused]);

  // ── Post a message ──────────────────────────────────────────────────────
  const post = useCallback(async () => {
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
        if (j.mute) setMyMute(j.mute as ChatMute);
        setChatError(j.error || "Failed to post");
        return;
      }
      if (j.message) setMessages((prev) => [...prev, j.message as ChatMessage]);
      setChatInput("");
      setChatError(null);
    } catch (e: any) {
      setChatError(e?.message || "Network error");
    } finally {
      setChatPosting(false);
    }
  }, [challengeId, identity, chatInput, chatPosting]);

  // ── Admin actions ──────────────────────────────────────────────────────
  const adminFetch = useCallback(async (url: string, body?: any): Promise<any> => {
    const headers: Record<string, string> = {
      "x-admin-key": adminToken,
      "x-admin-token": adminToken,
    };
    if (body) headers["Content-Type"] = "application/json";
    const r = await fetch(url, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
    return r.json();
  }, [adminToken]);

  // Prompt the user for the admin key, validate it (round-trip mutes endpoint
  // returns 401 on bad creds), and cache in sessionStorage on success. Returns
  // true on success.
  const requestAdminUnlock = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    const provided = window.prompt("🐜 Admin password");
    if (!provided) return false;
    try {
      const r = await fetch(`/api/faction-wars/pvp/chat/mutes?id=${encodeURIComponent(challengeId)}`, {
        headers: { "x-admin-key": provided, "x-admin-token": provided },
      });
      if (r.status === 401) {
        window.alert("Wrong password");
        return false;
      }
      // Success — cache and update state.
      try { sessionStorage.setItem("ra_admin_token", provided); } catch {}
      setAdminToken(provided);
      const j = await r.json().catch(() => null);
      if (j?.ok && Array.isArray(j.mutes)) setMutesList(j.mutes as ChatMute[]);
      return true;
    } catch {
      window.alert("Admin check failed");
      return false;
    }
  }, [challengeId]);

  const adminSignOut = useCallback(() => {
    try { sessionStorage.removeItem("ra_admin_token"); } catch {}
    setAdminToken("");
    setShowMutesPanel(false);
  }, []);

  const handleDelete = useCallback((messageId: string) => {
    if (!adminToken) return;
    if (armedDeleteId !== messageId) {
      // First click: arm.
      setArmedDeleteId(messageId);
      if (armedDeleteTimerRef.current) clearTimeout(armedDeleteTimerRef.current);
      armedDeleteTimerRef.current = setTimeout(() => setArmedDeleteId(null), 1000);
      return;
    }
    // Second click within 1s: delete.
    if (armedDeleteTimerRef.current) clearTimeout(armedDeleteTimerRef.current);
    setArmedDeleteId(null);
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    adminFetch("/api/faction-wars/pvp/chat/delete", { challengeId, messageId }).catch(() => {});
  }, [adminToken, armedDeleteId, adminFetch, challengeId]);

  const handleMute = useCallback(async (playerId: string, displayName: string, durationMs: number) => {
    if (!adminToken) return;
    setOpenMutePopoverFor(null);
    try {
      await adminFetch("/api/faction-wars/pvp/chat/mute", { challengeId, playerId, displayName, durationMs });
      // Refresh list if expanded.
      if (showMutesPanel) refreshMutes();
    } catch {}
  }, [adminToken, adminFetch, challengeId, showMutesPanel]);

  const handleUnmute = useCallback(async (playerId: string) => {
    if (!adminToken) return;
    try {
      await adminFetch("/api/faction-wars/pvp/chat/unmute", { challengeId, playerId });
      setMutesList((prev) => prev.filter((m) => m.playerId !== playerId));
    } catch {}
  }, [adminToken, adminFetch, challengeId]);

  const refreshMutes = useCallback(async () => {
    if (!adminToken) return;
    try {
      const j = await adminFetch(`/api/faction-wars/pvp/chat/mutes?id=${encodeURIComponent(challengeId)}`);
      if (j?.ok && Array.isArray(j.mutes)) setMutesList(j.mutes as ChatMute[]);
    } catch {}
  }, [adminToken, adminFetch, challengeId]);

  const handleClearAll = useCallback(async () => {
    if (!adminToken) return;
    if (typeof window === "undefined") return;
    if (!window.confirm("Wipe ALL chat messages for this match? This cannot be undone.")) return;
    setMessages([]);
    try {
      await adminFetch("/api/faction-wars/pvp/chat/clear", { challengeId });
    } catch {}
  }, [adminToken, adminFetch, challengeId]);

  return {
    // State
    messages, enabled, myMute,
    chatInput, setChatInput, chatPosting, chatError,
    isAdmin, adminModeOn, setAdminModeOn,
    armedDeleteId,
    openMutePopoverFor, setOpenMutePopoverFor,
    showMutesPanel, setShowMutesPanel,
    mutesList, refreshMutes,
    // Actions
    post, requestAdminUnlock, adminSignOut,
    handleDelete, handleMute, handleUnmute, handleClearAll,
  };
}

export type ChatState = ReturnType<typeof useChatState>;

// ─── ChatPanel component ────────────────────────────────────────────────────
export function ChatPanel({
  match, identity, chat, compact,
}: {
  match: PvpMatch | null;
  identity: { playerId: string; displayName: string } | null;
  chat: ChatState;
  // `compact` reduces vertical space (used in the floating drawer on the
  // battle page) — shorter scroll area, smaller header.
  compact?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Ref to the compose input so we can refocus it after each send. Without
  // this, the player has to click the input again every message — awful for
  // rapid trash talk during a match.
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Quick-reaction emojis — one tap inserts at the cursor end. Native OS
  // emoji keyboards still work (Cmd+Ctrl+Space on Mac, Win+. on Windows,
  // emoji button on iOS/Android), this just speeds up the most-used ones
  // so trash talk doesn't require leaving the chat box.
  const QUICK_EMOJIS = ["🔥","💀","😂","👀","⚡","🐜","🤡","💩"];

  // Wrap chat.post so we can re-focus the input after a successful send.
  // The setTimeout(0) lets React flush the disabled→enabled transition first
  // (the input is disabled while chatPosting === true).
  const doPost = async () => {
    await chat.post();
    setTimeout(() => { inputRef.current?.focus(); }, 0);
  };
  const insertEmoji = (emoji: string) => {
    const next = (chat.chatInput + emoji).slice(0, 280);
    chat.setChatInput(next);
    // Refocus after insert so the user can keep typing.
    setTimeout(() => { inputRef.current?.focus(); }, 0);
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length]);

  const muted = chat.myMute && chat.myMute.expireAt > Date.now();
  const remainingChars = 280 - chat.chatInput.length;

  const colorForRole = (r: ChatRole): string => {
    if (r === "challenger") return "#fbbf24";
    if (r === "opponent") return "#a5b4fc";
    return "rgba(255,255,255,0.85)";
  };

  // Admin menu (🐜) state — closed by default. Opens to a small dropdown
  // showing the admin tools when unlocked, or a "Sign in as admin" CTA when not.
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);

  const onAdminAntClick = async () => {
    if (chat.isAdmin) {
      setAdminMenuOpen((v) => !v);
      return;
    }
    // Not signed in yet — prompt for password.
    const ok = await chat.requestAdminUnlock();
    if (ok) setAdminMenuOpen(true);
  };

  return (
    <div style={{
      padding: compact ? "12px 14px" : "20px 22px",
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.12)",
      background: "rgba(10,10,18,0.96)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>
          💬 Chat
          <span style={{ marginLeft: 8, fontSize: 9, color: "rgba(255,255,255,0.35)" }}>
            ({chat.messages.length})
          </span>
        </div>
        {/* 🐜 Admin button — visible to everyone but only does anything for admins */}
        <div style={{ position: "relative" }}>
          <button
            onClick={onAdminAntClick}
            title={chat.isAdmin ? "Admin tools" : "Admin sign in"}
            style={{
              fontSize: 14,
              padding: "2px 8px",
              borderRadius: 12,
              background: chat.isAdmin && chat.adminModeOn ? "rgba(52,211,153,0.1)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${chat.isAdmin && chat.adminModeOn ? "rgba(52,211,153,0.4)" : "rgba(255,255,255,0.08)"}`,
              cursor: "pointer",
              opacity: chat.isAdmin ? 1 : 0.5,
              lineHeight: 1.2,
            }}
          >
            🐜
          </button>

          {/* Admin dropdown */}
          {chat.isAdmin && adminMenuOpen && (
            <div style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              minWidth: 200,
              padding: 6,
              borderRadius: 10,
              background: "rgba(15,15,25,0.98)",
              border: "1px solid rgba(255,255,255,0.15)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              zIndex: 20,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}>
              <button
                onClick={() => chat.setAdminModeOn(!chat.adminModeOn)}
                style={menuItemStyle(chat.adminModeOn ? "#34d399" : "rgba(255,255,255,0.7)")}
              >
                <span>🛡 Mod Tools on Hover</span>
                <span style={{ marginLeft: "auto", fontWeight: 900 }}>
                  {chat.adminModeOn ? "ON" : "OFF"}
                </span>
              </button>
              <button
                onClick={() => {
                  chat.setShowMutesPanel(!chat.showMutesPanel);
                  if (!chat.showMutesPanel) chat.refreshMutes();
                  setAdminMenuOpen(false);
                }}
                style={menuItemStyle("rgba(255,255,255,0.7)")}
              >
                <span>🔇 Muted Players</span>
                <span style={{ marginLeft: "auto", color: "rgba(255,255,255,0.5)" }}>
                  {chat.mutesList.length}
                </span>
              </button>
              <button
                onClick={() => { chat.handleClearAll(); setAdminMenuOpen(false); }}
                style={menuItemStyle("#f87171")}
              >
                🧹 Clear All Chat
              </button>
              <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "4px 0" }} />
              <button
                onClick={() => { chat.adminSignOut(); setAdminMenuOpen(false); }}
                style={menuItemStyle("rgba(255,255,255,0.4)")}
              >
                Sign Out Admin
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mutes admin panel (collapsible) */}
      {chat.isAdmin && chat.showMutesPanel && (
        <div style={{
          marginBottom: 10,
          padding: "10px 12px",
          borderRadius: 10,
          background: "rgba(248,113,113,0.04)",
          border: "1px dashed rgba(248,113,113,0.25)",
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(248,113,113,0.8)", marginBottom: 8 }}>
            Active Mutes
          </div>
          {chat.mutesList.length === 0 ? (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontStyle: "italic" }}>
              No active mutes
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {chat.mutesList.map((m) => (
                <div key={m.playerId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                  <span style={{ color: "white", fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.displayName || m.playerId}
                  </span>
                  <span style={{ color: "rgba(255,255,255,0.5)" }}>
                    {formatMuteUntil(m.expireAt)} left
                  </span>
                  <button
                    onClick={() => chat.handleUnmute(m.playerId)}
                    style={{
                      fontSize: 10, fontWeight: 700, color: "#34d399",
                      padding: "3px 8px", borderRadius: 8,
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
          maxHeight: compact ? 220 : 320,
          overflowY: "auto",
          padding: "4px 0",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {chat.messages.length === 0 ? (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontStyle: "italic", padding: "20px 8px", textAlign: "center" }}>
            No messages yet — be the first to talk trash.
          </div>
        ) : (
          chat.messages.map((m) => (
            <ChatRow
              key={m.id}
              message={m}
              colorForRole={colorForRole}
              isAdmin={chat.isAdmin}
              adminModeOn={chat.adminModeOn}
              armedDelete={chat.armedDeleteId === m.id}
              onDelete={() => chat.handleDelete(m.id)}
              isMutePopoverOpen={chat.openMutePopoverFor === m.id}
              setMutePopoverOpen={(open: boolean) => chat.setOpenMutePopoverFor(open ? m.id : null)}
              onMute={(durationMs: number) => chat.handleMute(m.playerId, m.displayName, durationMs)}
            />
          ))
        )}
      </div>

      {/* Compose box */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        {muted ? (
          <div style={{
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.3)",
            fontSize: 12, color: "#f87171", textAlign: "center",
          }}>
            🔇 You're muted in this match — {formatMuteUntil(chat.myMute!.expireAt)} remaining
          </div>
        ) : !identity ? (
          <div style={{
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.03)",
            border: "1px dashed rgba(255,255,255,0.15)",
            fontSize: 12, color: "rgba(255,255,255,0.6)", textAlign: "center",
          }}>
            <a href="/" style={{ color: "#fbbf24", textDecoration: "underline" }}>Sign in</a> to chat
          </div>
        ) : (
          <div>
            {/* Quick-reaction emoji row */}
            <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
              {QUICK_EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => insertEmoji(e)}
                  type="button"
                  style={{
                    width: 32, height: 32,
                    padding: 0,
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.04)",
                    fontSize: 16,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                  title={`Insert ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <input
                ref={inputRef}
                type="text"
                value={chat.chatInput}
                onChange={(e) => chat.setChatInput(e.target.value.slice(0, 280))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void doPost();
                  }
                }}
                placeholder="Talk trash, support your fave, hype the play..."
                disabled={chat.chatPosting}
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
                onClick={() => void doPost()}
                disabled={chat.chatPosting || !chat.chatInput.trim()}
                style={{
                  minWidth: 80, height: 38, padding: "0 14px", borderRadius: 10,
                  border: "1px solid rgba(251,191,36,0.4)",
                  background: chat.chatPosting || !chat.chatInput.trim() ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,rgba(251,191,36,0.25),rgba(248,113,113,0.2))",
                  color: chat.chatPosting || !chat.chatInput.trim() ? "rgba(255,255,255,0.4)" : "#fbbf24",
                  fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase",
                  cursor: chat.chatPosting ? "wait" : !chat.chatInput.trim() ? "not-allowed" : "pointer",
                }}
              >
                {chat.chatPosting ? "..." : "Send"}
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10 }}>
              <span style={{ color: chat.chatError ? "#f87171" : "rgba(255,255,255,0.4)" }}>
                {chat.chatError || "Press Enter to send"}
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
        flexDirection: "column",
        alignItems: "stretch",
        gap: 2,
        padding: "5px 8px",
        borderRadius: 6,
        background: hovered && showAdminTools ? "rgba(255,255,255,0.03)" : "transparent",
        fontSize: 13,
        lineHeight: 1.4,
        wordBreak: "break-word",
        overflowWrap: "anywhere",
      }}
    >
      {/* Header row: username + timestamp + admin actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{
          color: colorForRole(message.role),
          fontWeight: 700,
          flex: "1 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {message.displayName || "Anonymous"}
        </span>
        <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 10, flexShrink: 0 }}>
          {formatChatTime(message.at)}
        </span>
      </div>
      {/* Message body — full width below the header */}
      <span style={{ color: "rgba(255,255,255,0.92)", display: "block" }}>
        {message.text}
      </span>
      {showAdminIcons && (
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0, marginLeft: 4 }}>
          <button
            onClick={onDelete}
            title={armedDelete ? "Click again to confirm delete" : "Delete message"}
            style={{
              width: 24, height: 24, padding: 0, borderRadius: 6,
              border: armedDelete ? "1px solid rgba(248,113,113,0.7)" : "1px solid rgba(248,113,113,0.25)",
              background: armedDelete ? "rgba(248,113,113,0.2)" : "rgba(248,113,113,0.06)",
              color: "#f87171", fontSize: 11, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {armedDelete ? "?" : "🗑"}
          </button>
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setMutePopoverOpen(!isMutePopoverOpen)}
              title="Mute this player"
              style={{
                width: 24, height: 24, padding: 0, borderRadius: 6,
                border: "1px solid rgba(251,191,36,0.25)",
                background: "rgba(251,191,36,0.06)",
                color: "#fbbf24", fontSize: 11, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
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
                gap: 4, padding: 4, borderRadius: 8,
                background: "rgba(20,20,30,0.98)",
                border: "1px solid rgba(255,255,255,0.15)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                zIndex: 10,
              }}>
                <button onClick={() => onMute(HOUR)} style={muteBtnStyle()}>1h</button>
                <button onClick={() => onMute(24 * HOUR)} style={muteBtnStyle()}>24h</button>
                <button onClick={() => onMute(7 * DAY)} style={muteBtnStyle()}>7d</button>
                <button onClick={() => setMutePopoverOpen(false)} style={{ ...muteBtnStyle(), color: "rgba(255,255,255,0.5)" }}>✕</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Floating drawer (used on the battle page) ─────────────────────────────
// Bottom-right pill that expands to a chat panel. Tracks unread count when
// collapsed by remembering the message length at last close.
export function ChatDrawer({
  match, identity, chat,
}: {
  match: PvpMatch | null;
  identity: { playerId: string; displayName: string } | null;
  chat: ChatState;
}) {
  const [open, setOpen] = useState(false);
  // Remember messages.length at last close — anything new since then = unread.
  const [seenCount, setSeenCount] = useState<number>(0);
  // First load: don't pretend everything is unread; mark current count as seen.
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current && chat.messages.length > 0) {
      setSeenCount(chat.messages.length);
      initialized.current = true;
    }
  }, [chat.messages.length]);

  const unread = open ? 0 : Math.max(0, chat.messages.length - seenCount);

  const toggle = () => {
    if (!open) {
      // Opening — clear unread.
      setSeenCount(chat.messages.length);
    }
    setOpen(!open);
  };

  if (!chat.enabled) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: 16,
      right: 16,
      zIndex: 50,
      maxWidth: "calc(100vw - 24px)",
      width: open ? 380 : "auto",
    }}>
      {open && (
        <div style={{ marginBottom: 8 }}>
          <ChatPanel match={match} identity={identity} chat={chat} compact />
        </div>
      )}
      <button
        onClick={toggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          borderRadius: 999,
          border: "1px solid rgba(251,191,36,0.4)",
          background: open
            ? "linear-gradient(135deg, rgba(248,113,113,0.25), rgba(251,191,36,0.2))"
            : "linear-gradient(135deg, rgba(15,15,25,0.95), rgba(20,20,35,0.95))",
          color: "white",
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "0.05em",
          cursor: "pointer",
          boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
          marginLeft: "auto",
        }}
      >
        <span style={{ fontSize: 16 }}>{open ? "✕" : "💬"}</span>
        <span>{open ? "Close" : "Chat"}</span>
        {!open && unread > 0 && (
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 20,
            height: 20,
            padding: "0 6px",
            borderRadius: 10,
            background: "#f87171",
            color: "white",
            fontSize: 11,
            fontWeight: 900,
          }}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function menuItemStyle(color: string) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid transparent",
    background: "transparent",
    color,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer" as const,
    width: "100%" as const,
    textAlign: "left" as const,
  };
}
