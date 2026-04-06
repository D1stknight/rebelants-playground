// lib/winsStore.ts
export type WinEvent = {
  id: string;            // unique event id
  ts: number;            // timestamp
  game: "shuffle" | "tunnel" | "hatch" | "expedition" | "faction-wars";
  playerId: string;
  playerName: string;
  rarity: "none" | "common" | "rare" | "ultra";
  pointsAwarded: number;
};

type WinsState = {
  events: WinEvent[]; // newest first
  totals: Record<string, number>; // playerId -> total points earned (for leaderboard)
};

const KEY = "ra_wins_v1";

function load(): WinsState {
  if (typeof window === "undefined") return { events: [], totals: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { events: [], totals: {} };
    return JSON.parse(raw) as WinsState;
  } catch {
    return { events: [], totals: {} };
  }
}

function save(s: WinsState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function addWin(evt: WinEvent) {
  const s = load();

  // keep only last 50 events
  const nextEvents = [evt, ...(s.events || [])].slice(0, 50);

  const totals = { ...(s.totals || {}) };
  totals[evt.playerId] = (totals[evt.playerId] || 0) + (evt.pointsAwarded || 0);

  const next = { events: nextEvents, totals };
  save(next);
  return next;
}

export function getRecentWins(limit = 10): WinEvent[] {
  return load().events.slice(0, limit);
}

export function getLeaderboard(limit = 10): Array<{ playerId: string; total: number }> {
  const totals = load().totals || {};
  return Object.entries(totals)
    .map(([playerId, total]) => ({ playerId, total: Number(total || 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}
