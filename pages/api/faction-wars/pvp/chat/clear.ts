// POST /api/faction-wars/pvp/chat/clear
//
// Admin-only. Body: { challengeId }. Wipes the entire chat for a match.
// Used during stream emergencies (graphic content, raid, etc).

import type { NextApiRequest, NextApiResponse } from "next";
import { adminClearAllChat, checkAdminAuth } from "../../../../../lib/server/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!checkAdminAuth(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as Partial<{ challengeId: string }>;
    const challengeId = String(body.challengeId || "").trim().slice(0, 64);
    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing challengeId" });
    const cleared = await adminClearAllChat(challengeId);
    return res.status(200).json({ ok: true, cleared });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "clear failed" });
  }
}
