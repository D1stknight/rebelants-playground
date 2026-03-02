// lib/server/leaderboards.ts
import { redis } from "./redis";

export const LB_BALANCE = "ra:lb:balance";
export const LB_EARNED = "ra:lb:earned";
export const LB_WINS = "ra:lb:wins";
export const LB_RECENT_WINS = "ra:lb:recentWins";

// Total earned store (not daily; lifetime total)
export function earnedTotalKey(playerId: string) {
  return `ra:points:earnedTotal:${playerId}`;
}

export async function updateBalanceLeaderboard(playerId: string, newBalance: number) {
  await redis.zadd(LB_BALANCE, { score: Number(newBalance || 0), member: playerId });
}

export async function addToEarnedTotal(playerId: string, delta: number) {
  const d = Math.floor(Number(delta || 0));
  if (!Number.isFinite(d) || d <= 0) return { total: 0, added: 0 };

  const total = await redis.incrby(earnedTotalKey(playerId), d);
  await redis.zadd(LB_EARNED, { score: Number(total || 0), member: playerId });

  return { total: Number(total || 0), added: d };
}

export async function recordWinForLeaderboards(win: any) {
  // win should include: playerId, playerName, rarity, pointsAwarded, ts, game
  const pid = String(win?.playerId || "").trim();
  if (!pid) return;

  // ✅ wins count leaderboard
  await redis.zincrby(LB_WINS, 1, pid);

  // ✅ recent wins feed (store JSON)
  const payload = JSON.stringify({
    ...win,
    ts: Number(win?.ts || Date.now()),
  });

  await redis.lpush(LB_RECENT_WINS, payload);
  await redis.ltrim(LB_RECENT_WINS, 0, 49); // keep last 50
}
