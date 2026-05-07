// POST /api/faction-wars/pvp/chat/mute
//
// Admin-only. Body: { challengeId, playerId, durationMs, displayName? }.
// Sets a mute record with expireAt = now + durationMs. The player will see
// an explicit "you're muted until X" banner the next time they try to post.

import type { NextApiRequest, NextApiResponse } from "next";
import { setMute, checkAdminAuth } from "../../../../../lib/server/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!checkAdminAuth(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as Partial<{
      challengeId: string;
      playerId: string;
      durationMs: number;
      displayName: string;
    }>;
    const challengeId = String(body.challengeId || "").trim().slice(0, 64);
    const playerId = String(body.playerId || "").trim().slice(0, 64);
    const durationMs = Math.max(0, Math.floor(Number(body.durationMs)));
    const displayName = body.displayName ? String(body.displayName).trim().slice(0, 32) : undefined;
    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing challengeId" });
    if (!playerId) return res.status(400).json({ ok: false, error: "Missing playerId" });
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return res.status(400).json({ ok: false, error: "durationMs must be a positive number" });
    }
    // Cap at 30 days to avoid integer overflow weirdness.
    const capped = Math.min(durationMs, 1000 * 60 * 60 * 24 * 30);
    const record = await setMute(challengeId, playerId, capped, displayName);
    return res.status(200).json({ ok: true, mute: record });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "mute failed" });
  }
}
