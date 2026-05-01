// lib/usePoints.ts
import { useCallback, useEffect, useRef, useState } from "react";

type BalanceRes = {
  playerId: string;
  balance: number;
  earnedToday?: number;
  capBank?: number;
  dailyCap?: number;
  remainingDaily?: number;
  totalEarnRoom?: number;
};

type SpendRes = {
  ok: boolean;
  playerId: string;
  balance: number;
  earnedToday?: number;
  capBank?: number;
  dailyCap?: number;
  remainingDaily?: number;
  totalEarnRoom?: number;
  error?: string;
};

type EarnRes = {
  ok: boolean;
  playerId: string;
  balance: number;
  earnedToday?: number;
  capBank?: number;
  dailyCap?: number;
  remainingDaily?: number;
  totalEarnRoom?: number;
  added?: number;
  capped?: boolean;
  error?: string;
};

type DevGrantRes = {
  ok: boolean;
  dev: boolean;
  playerId: string;
  added: number;
  balance: number;
  capBank?: number;
  dailyCap?: number;
  remainingDaily?: number;
  totalEarnRoom?: number;
  error?: string;
};

function clampPid(v: string) {
  return (v || "guest").trim().slice(0, 64) || "guest";
}

export function usePoints(playerId: string) {
  // ✅ Always operate on the latest playerId (guest -> discord -> wallet)
  const playerIdRef = useRef<string>(clampPid(playerId));

  const [balance, setBalance] = useState(0);
  const [earnedToday, setEarnedToday] = useState(0);
  const [capBank, setCapBank] = useState(0);
  const [dailyCap, setDailyCap] = useState(0);
  const [remainingDaily, setRemainingDaily] = useState(0);
  const [totalEarnRoom, setTotalEarnRoom] = useState(0);

  const refresh = useCallback(async () => {
    const pid = clampPid(playerIdRef.current);

    const r = await fetch(
      `/api/points/balance?playerId=${encodeURIComponent(pid)}`,
      { cache: "no-store" }
    );

    const j = (await r.json().catch(() => null)) as BalanceRes | null;

    setBalance(Number(j?.balance || 0));
    setEarnedToday(Number(j?.earnedToday || 0));
    setCapBank(Number(j?.capBank || 0));
    setDailyCap(Number(j?.dailyCap || 0));
    setRemainingDaily(Number(j?.remainingDaily || 0));
    setTotalEarnRoom(Number(j?.totalEarnRoom || 0));
  }, []);

  // ✅ When playerId changes, clear old visible balance, update ref, and refresh immediately
  useEffect(() => {
    playerIdRef.current = clampPid(playerId);
    setBalance(0);
    setEarnedToday(0);
    setCapBank(0);
    setDailyCap(0);
    setRemainingDaily(0);
    setTotalEarnRoom(0);
    refresh().catch(() => {});
  }, [playerId, refresh]);

  // ✅ OAuth/profile changes can happen right after navigation returns.
  // Refresh once immediately and once shortly after so Discord-linked points appear without a manual page refresh.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const delayedRefresh = () => {
      refresh().catch(() => {});
      window.setTimeout(() => refresh().catch(() => {}), 300);
    };

    window.addEventListener("ra:identity-changed", delayedRefresh);
    window.addEventListener("pageshow", delayedRefresh);
    window.addEventListener("focus", delayedRefresh);

    return () => {
      window.removeEventListener("ra:identity-changed", delayedRefresh);
      window.removeEventListener("pageshow", delayedRefresh);
      window.removeEventListener("focus", delayedRefresh);
    };
  }, [refresh]);

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
        setEarnedToday(Number(j.earnedToday ?? earnedToday));
        setCapBank(Number(j.capBank || 0));
        setDailyCap(Number(j.dailyCap || 0));
        setRemainingDaily(Number(j.remainingDaily || 0));
        setTotalEarnRoom(Number(j.totalEarnRoom || 0));
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
        setEarnedToday(Number(j.earnedToday ?? earnedToday));
        setCapBank(Number(j.capBank || 0));
        setDailyCap(Number(j.dailyCap || 0));
        setRemainingDaily(Number(j.remainingDaily || 0));
        setTotalEarnRoom(Number(j.totalEarnRoom || 0));
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

  return {
    balance,
    earnedToday,
    capBank,
    dailyCap,
    remainingDaily,
    totalEarnRoom,
    spend,
    earn,
    claimDaily,
    devGrant,
    set,
    refresh,
  };
}
