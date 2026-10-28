// GET /api/badges/wall -> the player's Badge Wall on the Rebel Economy (every app's badges).
import type { NextApiRequest, NextApiResponse } from "next";
import { actingPlayer } from "../../../lib/server/player-auth";

const ECONOMY = process.env.ECONOMY_PUBLIC_URL || "https://economy.rebelants.io";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const who = await actingPlayer(req, String(req.query.playerId || "guest"));
    res.redirect(302, ECONOMY + "/badges" + (who.ok ? "/" + encodeURIComponent(who.user.userId) : ""));
  } catch {
    res.redirect(302, ECONOMY + "/badges");
  }
}
