// lib/usePoints.ts
import { useCallback, useEffect, useRef, useState } from "react";

type BalanceRes = { playerId: string; balance: number; earnedToday?: number };
type SpendRes = { ok: boolean; playerId: string; balance: number; earnedToday?: number; error?: string };
type EarnRes = { ok: boolean; playerId: string; balance: number; earnedToday?: number; added?: number; capped?: boolean; error?: string };
type DevGrantRes = { ok: boolean; dev: boolean; playerId: string; added: number; balance: number; error?: string };

function clampPid(v: string) {
  return (v || "guest").trim().slice(0, 64) || "guest";
}

export function usePoints(playerId: string) {
  // ✅ Always operate on the latest playerId (guest -> discord -> wallet)
  const playerIdRef = useRef<string>(clampPid(playerId));

  const [balance, setBalance] = useState(0);
  const [earnedToday, setEarnedToday] = useState(0);

  const refresh = useCallback(async () => {
    const pid = clampPid(playerIdRef.current);

    const r = await fetch(
      `/api/points/balance?playerId=${encodeURIComponent(pid)}`,
      { cache: "no-store" }
    );

    const j = (await r.json().catch(() => null)) as BalanceRes | null;

    setBalance(Number(j?.balance || 0));
    setEarnedToday(Number(j?.earnedToday || 0));
  }, []);

  // ✅ When playerId changes, update ref AND refresh immediately
  useEffect(() => {
    playerIdRef.current = clampPid(playerId);
    refresh().catch(() => {});
  }, [playerId, refresh]);

  const spend = useCallback(
    async (cost: number, reason?: string) => {
      const pid = clampPid(playerIdRef.current);

      const r = await fetch("/api/points/spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: pid, amount: cost, reason }),
      });

      const j = (await r.json().catch(() => null)) as SpendRes | null;

      if (r.ok && j && typeof j.balance === "number") {
        setBalance(j.balance);
        setEarnedToday(j.earnedToday ?? earnedToday);
        return j;
      }

      console.warn("spend failed:", r.status, j);
      await refresh();
      return (j || { ok: false, playerId: pid, balance, earnedToday }) as SpendRes;
    },
    [refresh, earnedToday, balance]
  );

  const earn = useCallback(
    async (amount: number) => {
      const pid = clampPid(playerIdRef.current);

      const r = await fetch("/api/points/earn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: pid, amount }),
      });

      const j = (await r.json().catch(() => null)) as EarnRes | null;

      if (r.ok && j && typeof j.balance === "number") {
        setBalance(j.balance);
        setEarnedToday(j.earnedToday ?? earnedToday);
        return j;
      }

      console.warn("earn failed:", r.status, j);
      await refresh();
      return (j || { ok: false, playerId: pid, balance, earnedToday }) as EarnRes;
    },
    [refresh, earnedToday, balance]
  );

  const claimDaily = useCallback(async (amount: number) => {
    return await earn(amount);
  }, [earn]);

  const devGrant = useCallback(
    async (amount: number) => {
      const pid = clampPid(playerIdRef.current);

      const r = await fetch("/api/points/dev-grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: pid, amount }),
      });

      const j = (await r.json().catch(() => null)) as DevGrantRes | null;

      if (r.ok && j && typeof j.balance === "number") {
        setBalance(j.balance);
        return j;
      }

      console.warn("devGrant failed:", r.status, j);
      await refresh();
      return (j || { ok: false, dev: true, playerId: pid, added: 0, balance }) as DevGrantRes;
    },
    [refresh, balance]
  );

  const set = useCallback(async (newBalance: number) => {
    setBalance(newBalance);
  }, []);

  return { balance, earnedToday, spend, earn, claimDaily, devGrant, set, refresh };
}
