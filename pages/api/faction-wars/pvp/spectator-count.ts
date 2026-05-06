// GET /api/faction-wars/pvp/spectator-count?id={challengeId}
//
// Returns the count of unique spectators currently watching the match
// (anyone who pinged in the last ~30s). Cheap, eventually consistent —
// SCAN-based count over a short prefix.

import type { NextApiRequest, NextApiResponse } from "next";
import { countSpectators } from "../../../../lib/server/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const challengeId = String(req.query.id || "").trim().slice(0, 64);
    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing id" });
    const count = await countSpectators(challengeId);
    return res.status(200).json({ ok: true, count });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "count failed" });
  }
}
