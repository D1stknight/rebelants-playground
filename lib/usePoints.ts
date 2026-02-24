// lib/usePoints.ts
import { useCallback, useEffect, useState } from "react";

type BalanceResp = { playerId: string; balance: number; earnedToday?: number };

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const text = await r.text();
  if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
  return JSON.parse(text) as T;
}

export function usePoints(playerId: string = "guest") {
  const [balance, setBalance] = useState(0);
  const [earnedToday, setEarnedToday] = useState(0);

  const refresh = useCallback(async () => {
    const data = await fetchJSON<BalanceResp>(
      `/api/points/balance?playerId=${encodeURIComponent(playerId)}`
    );
    setBalance(data.balance ?? 0);
    setEarnedToday(data.earnedToday ?? 0);
  }, [playerId]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const claimDaily = async (amount: number) => {
    await fetchJSON(`/api/points/earn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, amount, kind: "daily" }),
    });
    await refresh();
  };

  const spend = async (cost: number) => {
    await fetchJSON(`/api/points/spend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, amount: cost }),
    });
    await refresh();
  };

  const earn = async (amount: number) => {
    await fetchJSON(`/api/points/earn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, amount, kind: "win" }),
    });
    await refresh();
  };

  // DEV ONLY (server ignores daily cap in this endpoint)
  const devGrant = async (amount: number) => {
    await fetchJSON(`/api/points/dev-grant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, amount }),
    });
    await refresh();
  };

  return { balance, earnedToday, spend, earn, claimDaily, devGrant, refresh };
}
