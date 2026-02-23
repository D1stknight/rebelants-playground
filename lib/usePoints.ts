// lib/usePoints.ts
import { useCallback, useEffect, useState } from "react";

type BalanceResponse = { playerId: string; balance: number; earnedToday?: number };

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPost<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function usePoints(playerId: string = "guest") {
  const pid = (playerId || "guest").slice(0, 64);

  const [balance, setBalance] = useState(0);
  const [earnedToday, setEarnedToday] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await apiGet<BalanceResponse>(`/api/points/balance?playerId=${encodeURIComponent(pid)}`);
    setBalance(Number(data.balance || 0));
    setEarnedToday(Number(data.earnedToday || 0));
  }, [pid]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await refresh();
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  const spend = useCallback(
    async (amount: number) => {
      await apiPost(`/api/points/spend`, { playerId: pid, amount });
      await refresh();
    },
    [pid, refresh]
  );

  const earn = useCallback(
    async (amount: number) => {
      await apiPost(`/api/points/earn`, { playerId: pid, amount });
      await refresh();
    },
    [pid, refresh]
  );

  const claimDaily = useCallback(
    async (amount: number) => {
      // treat daily claim as an earn on server (server should enforce daily cap if you added it)
      await apiPost(`/api/points/earn`, { playerId: pid, amount, source: "daily" });
      await refresh();
    },
    [pid, refresh]
  );

  const devGrant = useCallback(
    async (amount: number) => {
      await apiPost(`/api/points/dev-grant`, { playerId: pid, amount });
      await refresh();
    },
    [pid, refresh]
  );

  return { balance, earnedToday, loading, spend, earn, claimDaily, devGrant, refresh };
}
