// pages/api/wins/add.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

const LB_WINS = "ra:lb:wins";
const RECENT_WINS_KEY = "ra:wins:recent"; // MUST match wins/recent + summary

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});

    const playerId = String(body.playerId || "guest").trim().slice(0, 64);
    const playerName = String(body.playerName || "guest").trim().slice(0, 64);
    const game = String(body.game || "shuffle").trim().slice(0, 32);
    const rarity = String(body.rarity || "none").trim().slice(0, 16);

    const pointsAwarded = Number(body.pointsAwarded || 0) || 0;

    const evt = {
      id: String(body.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      ts: Date.now(),
      game,
      playerId,
      playerName,
      rarity,
      pointsAwarded,
      prize: body.prize ?? null,
    };

    // 1️⃣ Increment wins leaderboard
    await redis.zincrby(LB_WINS, 1, playerId);

    // 2️⃣ Write recent wins list DIRECTLY
    await redis.lpush(RECENT_WINS_KEY, JSON.stringify(evt));
    await redis.ltrim(RECENT_WINS_KEY, 0, 49);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("wins/add error:", err);
    return res.status(500).json({ ok: false });
  }
}
