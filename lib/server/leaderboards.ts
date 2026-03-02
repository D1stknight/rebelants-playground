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

function safeWinPayload(win: any) {
  // ✅ Only keep fields that will ALWAYS JSON.stringify cleanly
  const prize = win?.prize;

  const safePrize =
    prize && typeof prize === "object"
      ? {
          type: typeof prize.type === "string" ? prize.type : undefined,
          label: typeof prize.label === "string" ? prize.label : undefined,
          sku: typeof prize.sku === "string" ? prize.sku : undefined,
          tokenId: typeof prize.tokenId === "string" || typeof prize.tokenId === "number" ? String(prize.tokenId) : undefined,
          qty: typeof prize.qty === "number" ? prize.qty : undefined,
        }
      : null;

  return {
    id: String(win?.id || ""),
    ts: Number(win?.ts || Date.now()),
    game: String(win?.game || "shuffle"),
    playerId: String(win?.playerId || ""),
    playerName: String(win?.playerName || ""),
    rarity: String(win?.rarity || "none"),
    pointsAwarded: Number(win?.pointsAwarded || 0) || 0,
    prize: safePrize,
  };
}

export async function recordWinForLeaderboards(win: any) {
  const pid = String(win?.playerId || "").trim().slice(0, 64);
  if (!pid) return;

  // ✅ wins count leaderboard
  await addToWinsTotal(pid, 1);

  // ✅ recent wins feed (store JSON)
  const payloadObj = safeWinPayload(win);

  let payloadStr = "";
  try {
    payloadStr = JSON.stringify(payloadObj);
  } catch {
    // ultra-safe fallback
    payloadStr = JSON.stringify({
      id: String(payloadObj.id || ""),
      ts: Number(payloadObj.ts || Date.now()),
      game: String(payloadObj.game || "shuffle"),
      playerId: String(payloadObj.playerId || pid),
      playerName: String(payloadObj.playerName || ""),
      rarity: String(payloadObj.rarity || "none"),
      pointsAwarded: Number(payloadObj.pointsAwarded || 0) || 0,
      prize: null,
    });
  }

  await redis.lpush(LB_RECENT_WINS, payloadStr);
  await redis.ltrim(LB_RECENT_WINS, 0, 49); // keep last 50
}
