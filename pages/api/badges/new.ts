// GET /api/badges/new -> badges this player earned since their screen last asked (shown once, then cleared).
import type { NextApiRequest, NextApiResponse } from "next";
import { actingPlayer } from "../../../lib/server/player-auth";
import { takeNewBadges } from "../../../lib/server/badges";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const who = await actingPlayer(req, String(req.query.playerId || "guest"));
    if (!who.ok) return res.status(200).json({ ok: true, badges: [] });
    return res.status(200).json({ ok: true, badges: await takeNewBadges(who.user.userId) });
  } catch {
    return res.status(200).json({ ok: true, badges: [] });
  }
}
