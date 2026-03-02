// pages/api/wins/add.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { LB_WINS, LB_RECENT_WINS } from "../../../lib/server/leaderboards";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});

    const playerId = String(body.playerId || "guest").trim().slice(0, 64) || "guest";
    const playerName = String(body.playerName || "guest").trim().slice(0, 64) || "guest";
    const game = String(body.game || "shuffle").trim().slice(0, 32) || "shuffle";
    const rarity = String(body.rarity || "none").trim().slice(0, 16) || "none";

    const pointsAwardedRaw = Number(body.pointsAwarded || 0);
    const pointsAwarded = Number.isFinite(pointsAwardedRaw) ? pointsAwardedRaw : 0;

    const evt = {
      id: String(body.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      ts: Number(body.ts || Date.now()),
      game,
      playerId,
      playerName,
      rarity,
      pointsAwarded,
      prize: body.prize ?? null,
    };

    // ✅ Top wins
    await redis.zincrby(LB_WINS, 1, playerId);

    // ✅ Recent wins (LIST) — this must match what summary reads
    await redis.lpush(LB_RECENT_WINS, JSON.stringify(evt));
    await redis.ltrim(LB_RECENT_WINS, 0, 49);

    return res.status(200).json({ ok: true, event: evt });
  } catch (err: any) {
    console.error("wins/add error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
