// lib/usePoints.ts
import { useCallback, useEffect, useState } from "react";

type BalanceRes = { playerId: string; balance: number };

async function postJSON<T>(url: string, body: any): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`${url} ${r.status}: ${txt || "request failed"}`);
  }
  return (await r.json()) as T;
}

export function usePoints(playerId: string) {
  const pid = (playerId || "guest").slice(0, 64);

  const [balance, setBalance] = useState(0);
  const [earnedToday] = useState(0); // (optional, keep for UI compatibility)

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/points/balance?playerId=${encodeURIComponent(pid)}`);
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`/api/points/balance ${r.status}: ${txt || "failed"}`);
    }
    const data = (await r.json()) as BalanceRes;
    setBalance(Number(data.balance || 0));
  }, [pid]);

  useEffect(() => {
    // load current balance when pid is ready
    refresh().catch(() => {});
  }, [refresh]);

  const spend = async (cost: number) => {
    await postJSON(`/api/points/spend`, { playerId: pid, amount: Number(cost) });
    await refresh();
  };

  const earn = async (amount: number) => {
    await postJSON(`/api/points/earn`, { playerId: pid, amount: Number(amount) });
    await refresh();
  };

  const claimDaily = async (amount: number) => {
    // this uses same earn endpoint (your server enforces daily cap)
    await postJSON(`/api/points/earn`, { playerId: pid, amount: Number(amount), kind: "daily" });
    await refresh();
  };

  const devGrant = async (amount: number) => {
    await postJSON(`/api/points/dev-grant`, { playerId: pid, amount: Number(amount) });
    await refresh();
  };

  const set = async (newBalance: number) => {
    // not used right now; keep signature so TS doesn't break.
    // If you want a real "set", we'd add an API route for it.
    setBalance(Number(newBalance || 0));
  };

  return { balance, earnedToday, spend, earn, claimDaily, devGrant, set, refresh };
}
