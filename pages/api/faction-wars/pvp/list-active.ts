// GET /api/faction-wars/pvp/list-active
//
// Returns currently-live PvP matches that are NOT marked private. Used by the
// public "⚔️ Live Matches" lobby section so any logged-in (or guest) viewer
// can browse what's happening right now and click in to spectate.
//
// Backed by the ACTIVE_INDEX_KEY set; listActiveMatches() handles filtering
// completed/cancelled/private matches and best-effort cleanup of stale ids.

import type { NextApiRequest, NextApiResponse } from "next";
import { listActiveMatches } from "../../../../lib/server/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50, Math.floor(limitRaw)) : 20;
    const matches = await listActiveMatches(limit);
    // Strip fields the lobby doesn't need (round history, full team detail) to
    // keep the payload small even at 20 rows. Spectate page re-fetches via
    // /api/faction-wars/pvp/get for the full state.
    const trimmed = matches.map((m) => ({
      challengeId: m.challengeId,
      status: m.status,
      challengerPlayerId: m.challengerPlayerId,
      challengerDisplayName: m.challengerDisplayName,
      opponentDisplayName: m.opponentDisplayName,
      currentTerritory: m.currentTerritory,
      challengerTerritoriesWon: m.challengerTerritoriesWon,
      opponentTerritoriesWon: m.opponentTerritoriesWon,
      pvpCost: m.pvpCost,
      lastActionAt: m.lastActionAt,
    }));
    return res.status(200).json({ ok: true, matches: trimmed });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "list-active failed" });
  }
}
