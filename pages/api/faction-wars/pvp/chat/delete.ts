// POST /api/faction-wars/pvp/chat/delete
//
// Admin-only. Body: { challengeId, messageId }. Removes a single message
// from the chat list using LREM. Auth via x-admin-key / x-admin-token
// header (same env var the rest of the admin API uses).

import type { NextApiRequest, NextApiResponse } from "next";
import { adminDeleteChatMessage, checkAdminAuth } from "../../../../../lib/server/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!checkAdminAuth(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as Partial<{ challengeId: string; messageId: string }>;
    const challengeId = String(body.challengeId || "").trim().slice(0, 64);
    const messageId = String(body.messageId || "").trim().slice(0, 32);
    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing challengeId" });
    if (!messageId) return res.status(400).json({ ok: false, error: "Missing messageId" });
    const removed = await adminDeleteChatMessage(challengeId, messageId);
    return res.status(200).json({ ok: true, removed });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "delete failed" });
  }
}
