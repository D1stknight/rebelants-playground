// GET /api/faction-wars/pvp/chat/mutes?id={challengeId}
//
// Admin-only. Returns currently-active mute records for a match. Used by the
// "Muted: N" panel in the spectate page to let admins view and revoke mutes.

import type { NextApiRequest, NextApiResponse } from "next";
import { listMutes, checkAdminAuth } from "../../../../../lib/server/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!checkAdminAuth(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  try {
    const challengeId = String(req.query.id || "").trim().slice(0, 64);
    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing id" });
    const mutes = await listMutes(challengeId);
    return res.status(200).json({ ok: true, mutes });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "mutes failed" });
  }
}
