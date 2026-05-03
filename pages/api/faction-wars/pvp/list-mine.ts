// GET /api/faction-wars/pvp/list-mine?playerId=<id>
//
// Returns the list of PvP matches the given player participates in.
// Sorts: active first (most recent), then pending, then completed,
// each group sorted by lastActionAt descending.
//
// V1: trusts the supplied playerId. In V2 we'll cross-check against the
// Discord/commander session cookie. The matches themselves are non-secret
// (anyone with a challengeId can fetch state via /pvp/get) so this only
// matters for "who can see the player's full match list."

import type { NextApiRequest, NextApiResponse } from "next";
import { listPlayerMatchIds, getMatch } from "../../../../lib/server/fwpvp";
import type { PvpMatch, PvpStatus } from "../../../../lib/types/fwpvp";

const STATUS_ORDER: Record<PvpStatus, number> = {
  active: 0,
  team_selection: 1,
  pending: 2,
  completed: 3,
  cancelled: 4,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  const playerId = String(req.query.playerId || "").trim().slice(0, 64);
  if (!playerId) return res.status(400).json({ ok: false, error: "Missing playerId" });

  const ids = await listPlayerMatchIds(playerId);
  if (ids.length === 0) return res.status(200).json({ ok: true, matches: [] });

  // Fetch all in parallel. Cap at 100 to keep payload bounded.
  const capped = ids.slice(0, 100);
  const matches = (await Promise.all(capped.map((id) => getMatch(id))))
    .filter((m): m is PvpMatch => m !== null);

  matches.sort((a, b) => {
    const sa = STATUS_ORDER[a.status] ?? 99;
    const sb = STATUS_ORDER[b.status] ?? 99;
    if (sa !== sb) return sa - sb;
    return b.lastActionAt - a.lastActionAt;
  });

  return res.status(200).json({ ok: true, matches });
}
