// lib/server/leaderboards.ts
import { redis } from "./redis";

// ✅ Canonical leaderboard keys (single source of truth)
export const LB_BALANCE = "ra:lb:balance";        // current balance visibility
export const LB_EARNED  = "ra:lb:totalEarned";    // lifetime earned from gameplay
export const LB_WINS    = "ra:lb:wins";           // lifetime wins count
export const LB_RECENT_WINS = "ra:wins:recent";   // recent wins feed list (JSON strings)

// ✅ helpers used by multiple APIs
export async function updateBalanceLeaderboard(playerId: string, newBalance: number) {
  const pid = String(playerId || "").trim().slice(0, 64);
  if (!pid) return;
  await redis.zadd(LB_BALANCE, { score: Number(newBalance || 0), member: pid });
}

export async function addToEarnedTotal(playerId: string, amount: number) {
  const pid = String(playerId || "").trim().slice(0, 64);
  const amt = Number(amount || 0);
  if (!pid || !Number.isFinite(amt) || amt <= 0) return;
  await redis.zincrby(LB_EARNED, amt, pid);
}

export async function addToWinsTotal(playerId: string, amount: number = 1) {
  const pid = String(playerId || "").trim().slice(0, 64);
  const amt = Number(amount || 0);
  if (!pid || !Number.isFinite(amt) || amt <= 0) return;
  await redis.zincrby(LB_WINS, amt, pid);
}

export async function recordWinForLeaderboards(win: any) {
  const pid = String(win?.playerId || "").trim().slice(0, 64);
  if (!pid) return;

  // ✅ wins count leaderboard
  await addToWinsTotal(pid, 1);

  // ✅ recent wins feed (store JSON)
  const payload = JSON.stringify({
    ...win,
    ts: Number(win?.ts || Date.now()),
  });

  await redis.lpush(LB_RECENT_WINS, payload);
  await redis.ltrim(LB_RECENT_WINS, 0, 49); // keep last 50
}
