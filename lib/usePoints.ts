// lib/usePoints.ts
import { useCallback, useEffect, useState } from "react";

type BalanceResponse = { playerId: string; balance: number };

export function usePoints(playerId: string) {
  const pid = (playerId || "guest").slice(0, 64);

  const [balance, setBalance] = useState(0);
  const [earnedToday, setEarnedToday] = useState(0); // keep for later; not wired yet

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/points/balance?playerId=${encodeURIComponent(pid)}`);
    const j = (await r.json()) as BalanceResponse;
    setBalance(j.balance || 0);
  }, [pid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const spend = async (cost: number) => {
    await fetch("/api/points/spend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: pid, amount: cost }),
    });
    await refresh();
  };

  const earn = async (amount: number) => {
    await fetch("/api/points/earn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: pid, amount }),
    });
    await refresh();
  };

  const claimDaily = async (amount: number) => {
    // For now daily claim uses earn endpoint (cap enforced server-side in earn.ts)
    await earn(amount);
  };

  // ✅ this is what your Dev button should call
  const devGrant = async (amount: number) => {
    await fetch("/api/points/dev-grant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: pid, amount }),
    });
    await refresh();
  };

  const set = async (newBalance: number) => {
    // optional for later; for now just force-refresh
    setBalance(newBalance);
  };

  return { balance, earnedToday, spend, earn, claimDaily, devGrant, set, refresh };
}
