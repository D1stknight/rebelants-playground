// lib/pointsStore.ts
import { pointsConfig } from "./pointsConfig";

type PointsState = {
  balance: number;
  earnedToday: number;
  lastEarnDay: string; // YYYY-MM-DD
};

const KEY = "ra_points_v1";

function todayKey(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function loadPoints(): PointsState {
  if (typeof window === "undefined") {
    return { balance: 0, earnedToday: 0, lastEarnDay: todayKey() };
  }

  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { balance: 0, earnedToday: 0, lastEarnDay: todayKey() };

    const parsed = JSON.parse(raw) as PointsState;
    const t = todayKey();

    // reset daily earned if new day
    if (parsed.lastEarnDay !== t) {
      return { balance: parsed.balance ?? 0, earnedToday: 0, lastEarnDay: t };
    }

    return {
      balance: Number(parsed.balance ?? 0),
      earnedToday: Number(parsed.earnedToday ?? 0),
      lastEarnDay: parsed.lastEarnDay ?? t,
    };
  } catch {
    return { balance: 0, earnedToday: 0, lastEarnDay: todayKey() };
  }
}

export function savePoints(state: PointsState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(state));
}

export function canSpend(cost: number): { ok: boolean; reason?: string } {
  const s = loadPoints();
  if (s.balance < cost) return { ok: false, reason: "Not enough points" };
  return { ok: true };
}

export function spend(cost: number): PointsState {
  const s = loadPoints();
  if (s.balance < cost) return s;
  const next = { ...s, balance: s.balance - cost };
  savePoints(next);
  return next;
}

export function earn(amount: number): PointsState {
  const s = loadPoints();
  const t = todayKey();

  // reset if day changed
  const base =
    s.lastEarnDay !== t ? { balance: s.balance, earnedToday: 0, lastEarnDay: t } : s;

  const remaining = Math.max(0, pointsConfig.dailyEarnCap - base.earnedToday);
  const grant = Math.max(0, Math.min(amount, remaining));

  const next = {
    ...base,
    balance: base.balance + grant,
    earnedToday: base.earnedToday + grant,
  };
  savePoints(next);
  return next;
}

export function claimDaily(amount: number): PointsState {
  const s = loadPoints();
  const t = new Date().toISOString().slice(0, 10);
  const claimKey = `ra_daily_claim_${t}`;

  if (typeof window === "undefined") return s;
  if (window.localStorage.getItem(claimKey)) return s;

  const next = earn(amount); // uses daily cap logic
  window.localStorage.setItem(claimKey, "1");
  return next;
}
