// pages/api/wins/add.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import {
  recordWinForLeaderboards,
  addToEarnedTotal,
} from "../../../lib/server/leaderboards";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};

    const playerId =
      String(body.playerId || "guest").trim().slice(0, 64) || "guest";
    const playerName =
      String(body.playerName || "guest").trim().slice(0, 32) || "guest";
    const game =
      String(body.game || "shuffle").trim().slice(0, 32) || "shuffle";
    const rarity =
      String(body.rarity || "none").trim().slice(0, 16) || "none";

    const pointsAwardedRaw = Number(body.pointsAwarded || 0);
    const pointsAwarded = Number.isFinite(pointsAwardedRaw)
      ? pointsAwardedRaw
      : 0;

    const prize = body.prize ?? null;

    const evt = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      game,
      playerId,
      playerName,
      rarity,
      pointsAwarded,
      prize,
    };

    // ✅ single source of truth for wins + recent wins
    await recordWinForLeaderboards(evt);

    // ✅ lifetime earned leaderboard (only if points > 0)
    if (evt.pointsAwarded > 0) {
      await addToEarnedTotal(playerId, evt.pointsAwarded);
    }

    return res.status(200).json({ ok: true, event: evt });
  } catch (err: any) {
    console.error("wins/add error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
