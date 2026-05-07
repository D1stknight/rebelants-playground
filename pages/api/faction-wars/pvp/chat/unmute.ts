// POST /api/faction-wars/pvp/chat/unmute
//
// Admin-only. Body: { challengeId, playerId }. Clears a player's mute record.

import type { NextApiRequest, NextApiResponse } from "next";
import { clearMute, checkAdminAuth } from "../../../../../lib/server/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!checkAdminAuth(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as Partial<{ challengeId: string; playerId: string }>;
    const challengeId = String(body.challengeId || "").trim().slice(0, 64);
    const playerId = String(body.playerId || "").trim().slice(0, 64);
    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing challengeId" });
    if (!playerId) return res.status(400).json({ ok: false, error: "Missing playerId" });
    await clearMute(challengeId, playerId);
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "unmute failed" });
  }
}
