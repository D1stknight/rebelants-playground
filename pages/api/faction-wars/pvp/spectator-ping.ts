// POST /api/faction-wars/pvp/spectator-ping
//
// Spectator client calls this every ~10s while watching a match. Each call
// refreshes a short-lived (TTL 30s) Redis key keyed by (challengeId, viewerKey).
// The "watching now" count is then `SCAN ra:fwpvp:spec:{challengeId}:*`.
//
// viewerKey is supplied by the client — typically a per-tab uuid stored in
// memory (not localStorage, since storage isn't allowed in artifacts and we
// keep the spectator page lightweight). Two tabs in the same browser count
// as two viewers.
//
// We deliberately avoid any auth here — anonymous spectators are expected.

import type { NextApiRequest, NextApiResponse } from "next";
import { pingSpectator, getMatch } from "../../../../lib/server/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as Partial<{
      challengeId: string;
      viewerKey: string;
    }>;
    const challengeId = String(body.challengeId || "").trim().slice(0, 64);
    const viewerKey = String(body.viewerKey || "").trim().slice(0, 64);
    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing challengeId" });
    if (!viewerKey) return res.status(400).json({ ok: false, error: "Missing viewerKey" });

    // Validate the match exists. We don't error on private matches here —
    // anyone with the direct link can be counted as a viewer.
    const match = await getMatch(challengeId);
    if (!match) return res.status(404).json({ ok: false, error: "Match not found" });

    await pingSpectator(challengeId, viewerKey);
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "ping failed" });
  }
}
