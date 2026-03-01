// lib/usePoints.ts
import { useCallback, useEffect, useState } from "react";

type BalanceRes = { playerId: string; balance: number; earnedToday?: number };
type SpendRes = { ok: boolean; playerId: string; balance: number; earnedToday?: number };
type EarnRes = { ok: boolean; playerId: string; balance: number; earnedToday?: number; applied?: number };
type DevGrantRes = { ok: boolean; dev: boolean; playerId: string; added: number; balance: number };

export function usePoints(playerId: string) {
  const pid = (playerId || "guest").slice(0, 64);

  const [balance, setBalance] = useState(0);
  const [earnedToday, setEarnedToday] = useState(0);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/points/balance?playerId=${encodeURIComponent(pid)}`, {
  cache: "no-store",
});
    const j = (await r.json()) as BalanceRes;
    setBalance(j.balance ?? 0);
    setEarnedToday(j.earnedToday ?? 0);
  }, [pid]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

   const spend = useCallback(
    async (cost: number, reason?: string) => {
      const r = await fetch("/api/points/spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: pid, amount: cost, reason }),
      });
      const j = (await r.json()) as SpendRes;
      if (r.ok && typeof j.balance === "number") {
        setBalance(j.balance);
        setEarnedToday(j.earnedToday ?? earnedToday);
      } else {
        await refresh();
      }
    },
    [pid, refresh, earnedToday]
  );

  const earn = useCallback(
    async (amount: number) => {
      const r = await fetch("/api/points/earn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: pid, amount }),
      });
      const j = (await r.json()) as EarnRes;
      if (r.ok && typeof j.balance === "number") {
        setBalance(j.balance);
        setEarnedToday(j.earnedToday ?? earnedToday);
      } else {
        await refresh();
      }
    },
    [pid, refresh, earnedToday]
  );

  const claimDaily = useCallback(
    async (amount: number) => {
      // daily is just "earn" but capped by your server logic
      await earn(amount);
    },
    [earn]
  );

  const devGrant = useCallback(
    async (amount: number) => {
      const r = await fetch("/api/points/dev-grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: pid, amount }),
      });
      const j = (await r.json()) as DevGrantRes;
      if (r.ok && typeof j.balance === "number") {
        setBalance(j.balance);
      } else {
        await refresh();
      }
    },
    [pid, refresh]
  );

  const set = useCallback(
    async (newBalance: number) => {
      // Optional: not used. Keep API as source of truth.
      setBalance(newBalance);
    },
    []
  );

  return { balance, earnedToday, spend, earn, claimDaily, devGrant, set, refresh };
}
