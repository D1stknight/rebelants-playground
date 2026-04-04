import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  const body = req.body || {};
  const playerId = String(body.playerId || "guest").trim().slice(0, 64) || "guest";
  const playerName = String(body.playerName || "guest").trim().slice(0, 40) || "guest";
  const score = Math.max(0, Number(body.score || 0));
  const fullClear = !!body.fullClear;
  const clearTimeMs = Math.max(0, Number(body.clearTimeMs || 0));
  const crystalsCollected = Math.max(0, Number(body.crystalsCollected || 0));
  const layoutIndex = typeof body.layoutIndex === "number" ? body.layoutIndex : null;
  const layoutName = typeof body.layoutName === "string" ? String(body.layoutName) : "";
  const member = playerId + "|" + playerName + "|" + layoutName;
  try {
    await redis.hset("tunnel:player:" + playerId + ":stats", { playerName });
    await redis.hincrby("tunnel:player:" + playerId + ":stats", "totalRuns", 1);
    await redis.hincrby("tunnel:player:" + playerId + ":stats", "totalCrystals", crystalsCollected);
    if (score > 0) {
      const prev = Number(await redis.hget("tunnel:player:" + playerId + ":stats", "bestScore") || 0);
      if (score > prev) await redis.hset("tunnel:player:" + playerId + ":stats", { bestScore: score });
      await redis.zadd("tunnel:top:score", { score: Number(score), member });
      if (layoutIndex !== null) await redis.zadd("tunnel:layout:" + layoutIndex + ":scores", { score: Number(score), member });
    }
    if (fullClear && clearTimeMs > 0) {
      const pf = await redis.zscore("tunnel:top:clear", member);
      if (pf === null || clearTimeMs < -Number(pf)) {
        await redis.zadd("tunnel:top:clear", { score: -clearTimeMs, member });
        await redis.hset("tunnel:player:" + playerId + ":stats", { bestClearTimeMs: clearTimeMs });
      }
    }
    if (layoutIndex !== null) await redis.sadd("tunnel:player:" + playerId + ":explored", String(layoutIndex));
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "error" });
  }
}
