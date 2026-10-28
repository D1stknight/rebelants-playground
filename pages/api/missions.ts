// GET /api/missions?playerId= -> today's 3, this week's 3 and the Season step (Playground + Underground).
// The economy keeps missions; they move on their own as games report results.
import type { NextApiRequest, NextApiResponse } from "next";
import { actingPlayer } from "../../lib/server/player-auth";
import { economyRead } from "../../lib/server/badges";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const who = await actingPlayer(req, String(req.query.playerId || "guest"));
    if (!who.ok) return res.status(401).json({ ok: false, error: "sign_in" });
    const data = await economyRead("/api/internal/missions?userId=" + encodeURIComponent(who.user.userId));
    if (!data) return res.status(502).json({ ok: false, error: "economy" });
    return res.status(200).json({ ...data, now: Date.now() });
  } catch {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
