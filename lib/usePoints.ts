// lib/usePoints.ts
import { useCallback, useEffect, useRef, useState } from "react";

type BalanceRes = { playerId: string; balance: number; earnedToday?: number };
type SpendRes = { ok: boolean; playerId: string; balance: number; earnedToday?: number; error?: string };
type EarnRes = { ok: boolean; playerId: string; balance: number; earnedToday?: number; added?: number; capped?: boolean; error?: string };
type DevGrantRes = { ok: boolean; dev: boolean; playerId: string; added: number; balance: number; error?: string };

export function usePoints(playerId: string) {
  // ✅ always use the latest id (prevents "stuck on guest" after discord connect)
  const playerIdRef = useRef((playerId || "guest").slice(0, 64));
  useEffect(() => {
    playerIdRef.current = (playerId || "guest").slice(0, 64);
  }, [playerId]);

  const [balance, setBalance] = useState(0);
  const [earnedToday, setEarnedToday] = useState(0);

    const refresh = useCallback(async () => {
    const r = await fetch(
      `/api/points/balance?playerId=${encodeURIComponent(playerIdRef.current)}`,
      { cache: "no-store" }
    );
    const j = (await r.json()) as BalanceRes;
    setBalance(j.balance ?? 0);
    setEarnedToday(j.earnedToday ?? 0);
  }, [playerId]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const spend = useCallback(
    async (cost: number, reason?: string) => {
           const r = await fetch("/api/points/spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: playerIdRef.current, amount: cost, reason }),
      });

      const j = (await r.json().catch(() => null)) as SpendRes | null;

      if (r.ok && j && typeof j.balance === "number") {
        setBalance(j.balance);
        setEarnedToday(j.earnedToday ?? earnedToday);
        return j;
      } else {
        console.warn("spend failed:", r.status, j);
        await refresh();
                return (j || { ok: false, playerId: playerIdRef.current, balance, earnedToday }) as SpendRes;
      }
    },
        [playerId, refresh, earnedToday, balance]
  );

  const earn = useCallback(
    async (amount: number) => {
           const r = await fetch("/api/points/earn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: playerIdRef.current, amount }),
      });

      const j = (await r.json().catch(() => null)) as EarnRes | null;

      if (r.ok && j && typeof j.balance === "number") {
        setBalance(j.balance);
        setEarnedToday(j.earnedToday ?? earnedToday);
        return j;
      } else {
        console.warn("earn failed:", r.status, j);
        await refresh();
               return (j || { ok: false, playerId: playerIdRef.current, balance, earnedToday }) as EarnRes;
      }
    },
       [playerId, refresh, earnedToday, balance]
  );

  const claimDaily = useCallback(
    async (amount: number) => {
      return await earn(amount);
    },
    [earn]
  );

  const devGrant = useCallback(
    async (amount: number) => {
            const r = await fetch("/api/points/dev-grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: playerIdRef.current, amount }),
      });

      const j = (await r.json().catch(() => null)) as DevGrantRes | null;

      if (r.ok && j && typeof j.balance === "number") {
        setBalance(j.balance);
        return j;
      } else {
        console.warn("devGrant failed:", r.status, j);
        await refresh();
                return (j || { ok: false, dev: true, playerId: playerIdRef.current, added: 0, balance }) as DevGrantRes;
      }
    },
        [playerId, refresh, balance]
  );

  const set = useCallback(async (newBalance: number) => {
    setBalance(newBalance);
  }, []);

  // ✅ IMPORTANT: spend is returned here
  return { balance, earnedToday, spend, earn, claimDaily, devGrant, set, refresh };
}
