// lib/usePoints.ts
import { useEffect, useMemo, useState } from "react";
import { loadProfile } from "./profile";

/**
 * API-backed points (Redis)
 * Uses:
 *  - GET  /api/points/balance?playerId=...
 *  - POST /api/points/earn   { playerId, amount }
 *  - POST /api/points/spend  { playerId, amount }
 *
 * NOTE:
 * earnedToday is not returned by the current balance endpoint, so we keep it as 0 for now.
 * (We can add it later when we build the real ledger.)
 */
export function usePoints() {
  const [balance, setBalance] = useState(0);
  const [earnedToday, setEarnedToday] = useState(0);
  const [playerId, setPlayerId] = useState("guest");

  // resolve playerId from local profile (client-only)
  useEffect(() => {
    try {
      const p = loadProfile();
      setPlayerId((p?.id || "guest").slice(0, 64));
    } catch {
      setPlayerId("guest");
    }
  }, []);

  const qsPlayerId = useMemo(() => encodeURIComponent(playerId || "guest"), [playerId]);

  const refresh = async () => {
    try {
      const res = await fetch(`/api/points/balance?playerId=${qsPlayerId}`);
      if (!res.ok) throw new Error(`balance_http_${res.status}`);
      const data = await res.json();
      setBalance(Number(data?.balance || 0));
      // not provided yet by API
      setEarnedToday(Number(data?.earnedToday || 0));
    } catch {
      // If API is down, keep current UI state (no crash)
    }
  };

  // initial fetch once playerId is known
  useEffect(() => {
    if (!playerId) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  const postJSON = async (url: string, body: any) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = `http_${res.status}`;
      try {
        const j = await res.json();
        msg = j?.error || j?.message || msg;
      } catch {}
      throw new Error(msg);
    }
    return res.json().catch(() => ({}));
  };

  const claimDaily = async (amount: number) => {
    // For now, daily claim is just an "earn" that is capped server-side.
    try {
      await postJSON("/api/points/earn", { playerId, amount });
      await refresh();
    } catch {
      // ignore for now (we can surface toast later)
    }
  };

  const spend = async (cost: number) => {
    try {
      await postJSON("/api/points/spend", { playerId, amount: cost });
      await refresh();
    } catch {
      // ignore for now
    }
  };

  const earn = async (amount: number) => {
    try {
      await postJSON("/api/points/earn", { playerId, amount });
      await refresh();
    } catch {
      // ignore for now
    }
  };

  // Not used in your UI right now; keep for compatibility.
  const set = async (newBalance: number) => {
    // If you ever need this, we’ll add a server endpoint.
    // For now: just refresh.
    void newBalance;
    await refresh();
  };

  return { balance, earnedToday, spend, earn, claimDaily, set, refresh, playerId };
}
