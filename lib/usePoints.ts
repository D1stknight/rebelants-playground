// lib/usePoints.ts
import { useEffect, useMemo, useState } from "react";
import { loadProfile } from "./profile";

type BalanceResponse = {
  playerId: string;
  balance: number;
};

type SpendResponse = {
  ok: boolean;
  playerId: string;
  spent: number;
  balance: number;
};

type EarnResponse = {
  ok: boolean;
  playerId: string;
  added: number;
  balance: number;
  // optional (if your API returns it)
  earnedToday?: number;
  capped?: boolean;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // ignore
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export function usePoints() {
  const prof = useMemo(() => loadProfile(), []);
  const playerId = (prof?.id || "guest").slice(0, 64);

  const [balance, setBalance] = useState(0);
  const [earnedToday, setEarnedToday] = useState(0);

  const refresh = async () => {
    const data = await fetchJson<BalanceResponse>(`/api/points/balance?playerId=${encodeURIComponent(playerId)}`);
    setBalance(Number(data.balance || 0));
  };

  useEffect(() => {
    refresh().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const spend = async (cost: number) => {
    const data = await fetchJson<SpendResponse>("/api/points/spend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, amount: cost }),
    });
    setBalance(Number(data.balance || 0));
  };

  const earn = async (amount: number) => {
    const data = await fetchJson<EarnResponse>("/api/points/earn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, amount }),
    });
    setBalance(Number(data.balance || 0));
    if (typeof data.earnedToday === "number") setEarnedToday(data.earnedToday);
  };

  // For now: daily claim is just an "earn" call (your server enforces daily cap).
  // Later we can add true "once per day" logic server-side.
  const claimDaily = async (amount: number) => {
    await earn(amount);
  };

  // Optional helper (rarely needed)
  const set = async (newBalance: number) => {
    // no direct "set" endpoint yet — keep local state in sync by refreshing
    await refresh();
  };

  return { balance, earnedToday, spend, earn, claimDaily, set, refresh };
}
