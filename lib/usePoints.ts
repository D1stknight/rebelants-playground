// lib/usePoints.ts
import { useCallback, useEffect, useState } from "react";

type BalanceResp = { playerId: string; balance: number };

export function usePoints(playerId: string = "guest") {
  const pid = (playerId || "guest").slice(0, 64);

  const [balance, setBalance] = useState(0);
  const [earnedToday, setEarnedToday] = useState(0); // optional for now (keep UI compatible)

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/points/balance?playerId=${encodeURIComponent(pid)}`);
    if (!r.ok) throw new Error(`balance fetch failed: ${r.status}`);
    const data = (await r.json()) as BalanceResp;
    setBalance(Number(data.balance || 0));
    // earnedToday is not returned by the API right now; keep at 0 unless you add it later
    setEarnedToday(0);
  }, [pid]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const spend = useCallback(
    async (cost: number) => {
      const r = await fetch("/api/points/spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: pid, amount: cost }),
      });
      if (!r.ok) throw new Error(`spend failed: ${r.status}`);
      await refresh();
    },
    [pid, refresh]
  );

  const earn = useCallback(
    async (amount: number) => {
      const r = await fetch("/api/points/earn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: pid, amount }),
      });
      if (!r.ok) throw new Error(`earn failed: ${r.status}`);
      await refresh();
    },
    [pid, refresh]
  );

  // for now we treat "daily claim" as an earn with cap enforcement handled server-side
  const claimDaily = useCallback(
    async (amount: number) => {
      const r = await fetch("/api/points/earn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: pid, amount, reason: "daily" }),
      });
      if (!r.ok) throw new Error(`daily claim failed: ${r.status}`);
      await refresh();
    },
    [pid, refresh]
  );

  // ✅ DEV ONLY: bypass cap (hits /api/points/dev-grant)
  const devGrant = useCallback(
    async (amount: number) => {
      const r = await fetch("/api/points/dev-grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: pid, amount }),
      });
      if (!r.ok) throw new Error(`dev grant failed: ${r.status}`);
      await refresh();
    },
    [pid, refresh]
  );

  const set = useCallback(
    async (newBalance: number) => {
      // optional: if you don't have a /set endpoint, skip using this for now
      setBalance(newBalance);
    },
    []
  );

  return { balance, earnedToday, spend, earn, claimDaily, devGrant, set, refresh };
}
