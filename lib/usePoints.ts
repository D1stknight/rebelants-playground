// lib/usePoints.ts
import { useCallback, useEffect, useState } from "react";

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as T;
}

async function postJSON<T>(url: string, body: any): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as T;
}

/**
 * Server-backed points hook (Upstash / API routes).
 * IMPORTANT: This hook expects your API routes:
 * - GET  /api/points/balance?playerId=...
 * - POST /api/points/spend
 * - POST /api/points/earn
 * - POST /api/points/dev-grant   (dev only)
 */
export function usePoints(playerId: string) {
  const pid = (playerId || "guest").slice(0, 64);

  const [balance, setBalance] = useState(0);
  const [earnedToday, setEarnedToday] = useState(0); // (optional, keep 0 unless your API returns it)
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getJSON<{ playerId: string; balance: number; earnedToday?: number }>(
        `/api/points/balance?playerId=${encodeURIComponent(pid)}`
      );
      setBalance(Number(data.balance || 0));
      setEarnedToday(Number(data.earnedToday || 0));
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const spend = useCallback(
    async (cost: number) => {
      await postJSON(`/api/points/spend`, { playerId: pid, amount: cost });
      await refresh();
    },
    [pid, refresh]
  );

  const earn = useCallback(
    async (amount: number) => {
      await postJSON(`/api/points/earn`, { playerId: pid, amount });
      await refresh();
    },
    [pid, refresh]
  );

  // Daily claim is just "earn" through the same rules/cap on the server
  const claimDaily = useCallback(
    async (amount: number) => {
      await postJSON(`/api/points/earn`, { playerId: pid, amount, source: "daily" });
      await refresh();
    },
    [pid, refresh]
  );

  // DEV ONLY: bypass daily cap via /api/points/dev-grant
  const devGrant = useCallback(
    async (amount: number) => {
      await postJSON(`/api/points/dev-grant`, { playerId: pid, amount });
      await refresh();
    },
    [pid, refresh]
  );

  const set = useCallback(
    async (newBalance: number) => {
      // Optional helper if you ever create a set endpoint later.
      // For now just refresh.
      setBalance(newBalance);
      await refresh();
    },
    [refresh]
  );

  return { balance, earnedToday, loading, spend, earn, claimDaily, devGrant, set, refresh };
}
