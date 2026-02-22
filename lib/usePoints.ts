// lib/usePoints.ts
import { useEffect, useState } from "react";
import { loadPoints, savePoints, spend as spendStore, earn as earnStore } from "./pointsStore";

export function usePoints() {
  const [balance, setBalance] = useState(0);
  const [earnedToday, setEarnedToday] = useState(0);

  useEffect(() => {
    const s = loadPoints();
    setBalance(s.balance);
    setEarnedToday(s.earnedToday);
  }, []);

  const refresh = () => {
    const s = loadPoints();
    setBalance(s.balance);
    setEarnedToday(s.earnedToday);
  };

  const spend = (cost: number) => {
    spendStore(cost);
    refresh();
  };

  const earn = (amount: number) => {
    earnStore(amount);
    refresh();
  };

  const set = (newBalance: number) => {
    const s = loadPoints();
    const next = { ...s, balance: newBalance };
    savePoints(next);
    refresh();
  };

  return { balance, earnedToday, spend, earn, set, refresh };
}
