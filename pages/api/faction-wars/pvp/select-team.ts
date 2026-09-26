import { withPlaygroundMatchExperience } from "../../../../lib/server/raap-fwpvp-experience";
// POST /api/faction-wars/pvp/select-team
//
// Either player submits their 5-faction team. Both players must have submitted
// before the match goes from "team_selection" -> "active". Once active, the
// challenger gets the first turn at territory 0.
//
// Constraints:
//   - team length === 5
//   - all 5 must be valid faction ids
//   - no duplicates within a team (single-player rule mirrored)
//   - status must be "team_selection"
//   - playerId must match either challenger or opponent

import type { NextApiRequest, NextApiResponse } from "next";
import { getMatch, saveMatch } from "../../../../lib/server/fwpvp";
import {applyPvpTeam, sanitizeTeam, PvpRuleError} from "../../../../lib/server/fwpvp-rules";
import type {SelectTeamRequest} from "../../../../lib/types/fwpvp";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as Partial<SelectTeamRequest>;
    const challengeId = String(body.challengeId || "").trim().slice(0, 64);
    const playerId = String(body.playerId || "").trim().slice(0, 64);
    const team = sanitizeTeam(body.team);

    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing challengeId" });
    if (!playerId) return res.status(400).json({ ok: false, error: "Missing playerId" });
    if (team === null) return res.status(400).json({ ok: false, error: "Invalid team (need 5 unique factions)" });

    const current = await getMatch(challengeId);
    if (!current) return res.status(404).json({ ok: false, error: "Match not found" });

    const match = applyPvpTeam(current, playerId, team, Date.now());

    await saveMatch(match);
    return res.status(200).json({ ok: true, match });
  } catch (e: any) {
    if (e instanceof PvpRuleError) return res.status(e.status).json({ok:false,error:e.message});
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}

export default withPlaygroundMatchExperience("select-team", handler);
