// lib/usePoints.ts
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadProfile } from "./profile";

type BalanceResponse = { playerId: string; balance: number };

function getPlayerIdSafe() {
  try {
    const p = loadProfile();
    return (p?.id || "guest").slice(0, 64);
  } catch {
    return "guest";
  }
}

export function usePoints() {
  const playerId = useMemo(() => getPlayerIdSafe(), []);
  const [balance, setBalance] = useState(0);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/points/balance?playerId=${encodeURIComponent(playerId)}`);
    if (!r.ok) throw new Error(`balance_failed_${r.status}`);
    const data = (await r.json()) as BalanceResponse;
    setBalance(Number(data.balance || 0));
  }, [playerId]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const spend = useCallback(
    async (cost: number) => {
      const r = await fetch("/api/points/spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, cost }),
      });
      if (!r.ok) throw new Error(`spend_failed_${r.status}`);
      await refresh();
    },
    [playerId, refresh]
  );

  const earn = useCallback(
    async (amount: number) => {
      const r = await fetch("/api/points/earn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, amount }),
      });
      if (!r.ok) throw new Error(`earn_failed_${r.status}`);
      await refresh();
    },
    [playerId, refresh]
  );

  const claimDaily = useCallback(
    async (amount: number) => {
      // daily is just an earn on the server (server enforces daily cap if implemented there)
      const r = await fetch("/api/points/earn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, amount, reason: "daily" }),
      });
      if (!r.ok) throw new Error(`daily_failed_${r.status}`);
      await refresh();
    },
    [playerId, refresh]
  );

  const set = useCallback(
    async (newBalance: number) => {
      // Optional: not used right now. Keep for compatibility.
      setBalance(Number(newBalance || 0));
    },
    []
  );

  return { balance, earnedToday: 0, spend, earn, claimDaily, set, refresh };
}
