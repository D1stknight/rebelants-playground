// pages/api/boards/siege-start.ts — The Siege is free: the server opens a session for the signed-in defender so the
// result can go on the boards once (lib/server/gameBoards.ts).
import type { NextApiRequest, NextApiResponse } from "next";
import { actingPlayer } from "../../../lib/server/player-auth";
import { openSiegeSession } from "../../../lib/server/gameBoards";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
    const who = await actingPlayer(req, body.playerId);
    if (!who.ok) return res.status(200).json({ ok: true, session: null, signIn: who.signIn });
    const s = await openSiegeSession({ userId: who.user.userId, playerId: who.playerId, faction: String(body.faction || "") });
    return res.status(200).json({ ok: true, session: s.id });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed" });
  }
}
