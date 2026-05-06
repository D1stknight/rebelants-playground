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
import { TEAM_SIZE, FACTION_IDS } from "../../../../lib/factionWarsCore";
import type { FactionId } from "../../../../lib/factionWarsCore";
import type { SelectTeamRequest } from "../../../../lib/types/fwpvp";

const VALID = new Set<string>(FACTION_IDS);

function sanitizeTeam(raw: unknown): FactionId[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length !== TEAM_SIZE) return null;
  const seen = new Set<string>();
  const out: FactionId[] = [];
  for (const item of raw) {
    const id = String(item).toLowerCase();
    if (!VALID.has(id)) return null;
    if (seen.has(id)) return null;
    seen.add(id);
    out.push(id as FactionId);
  }
  return out;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    const match = await getMatch(challengeId);
    if (!match) return res.status(404).json({ ok: false, error: "Match not found" });

    // Allow team submission during pending (challenger only) OR team_selection (either)
    const isChallenger = playerId === match.challengerPlayerId;
    const isOpponent = playerId === match.opponentPlayerId;
    if (!isChallenger && !isOpponent) {
      return res.status(403).json({ ok: false, error: "You are not a participant in this match" });
    }
    if (match.status !== "pending" && match.status !== "team_selection") {
      return res.status(409).json({ ok: false, error: `Cannot select team; match is ${match.status}` });
    }
    if (match.status === "pending" && !isChallenger) {
      return res.status(409).json({ ok: false, error: "Opponent has not accepted yet" });
    }

    const now = Date.now();
    if (isChallenger) match.challengerTeam = team;
    if (isOpponent) match.opponentTeam = team;
    match.updatedAt = now;
    match.lastActionAt = now;

    // If both teams are locked AND we're in team_selection, transition to active.
    const bothLocked = match.challengerTeam.length === TEAM_SIZE && match.opponentTeam.length === TEAM_SIZE;
    if (bothLocked && match.status === "team_selection") {
      match.status = "active";
      match.currentTurnSide = "challenger";
      match.currentTurnPlayerId = match.challengerPlayerId;
    }

    await saveMatch(match);
    return res.status(200).json({ ok: true, match });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}
