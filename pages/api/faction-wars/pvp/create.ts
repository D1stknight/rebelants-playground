// POST /api/faction-wars/pvp/create
//
// Creates a new PvP challenge. Returns the challengeId and shareable path.
// Challenger may optionally lock their team at create time. If not, they pick
// after the opponent accepts (same screen as opponent).
//
// Identity: we trust the supplied playerId/displayName. Step 1 doesn't verify
// the caller against the Discord cookie or commander session — that's added
// before this is exposed in real UI. For now, only callers from our own
// frontend will hit this.

import type { NextApiRequest, NextApiResponse } from "next";
import { generateChallengeId, saveMatch, addPlayerMatch } from "../../../../lib/server/fwpvp";
import { TEAM_SIZE, MAX_HP, FACTIONS, FACTION_IDS } from "../../../../lib/factionWarsCore";
import type { PvpMatch, CreateChallengeRequest } from "../../../../lib/types/fwpvp";
import type { FactionId } from "../../../../lib/factionWarsCore";

const VALID_FACTION_IDS = new Set<string>(FACTION_IDS);

function sanitizeTeam(raw: unknown): FactionId[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length !== TEAM_SIZE) return null;
  const seen = new Set<string>();
  const out: FactionId[] = [];
  for (const item of raw) {
    const id = String(item).toLowerCase();
    if (!VALID_FACTION_IDS.has(id)) return null;
    if (seen.has(id)) return null; // no duplicates
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
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as Partial<CreateChallengeRequest>;
    const challengerPlayerId = String(body.challengerPlayerId || "").trim().slice(0, 64);
    const challengerDisplayName = String(body.challengerDisplayName || "").trim().slice(0, 64);
    if (!challengerPlayerId) return res.status(400).json({ ok: false, error: "Missing challengerPlayerId" });
    if (!challengerDisplayName) return res.status(400).json({ ok: false, error: "Missing challengerDisplayName" });

    let challengerTeam: FactionId[] = [];
    if (body.challengerTeam !== undefined) {
      const t = sanitizeTeam(body.challengerTeam);
      if (t === null) return res.status(400).json({ ok: false, error: "Invalid challengerTeam" });
      challengerTeam = t;
    }

    const challengeId = generateChallengeId();
    const now = Date.now();

    const match: PvpMatch = {
      challengeId,
      status: "pending",
      challengerPlayerId,
      challengerDisplayName,
      opponentPlayerId: null,
      opponentDisplayName: null,
      challengerTeam,
      opponentTeam: [],
      currentTurnPlayerId: null,
      currentTurnSide: null,
      challengerCurrentFactionIndex: 0,
      opponentCurrentFactionIndex: 0,
      challengerHp: MAX_HP,
      opponentHp: MAX_HP,
      currentTerritory: 0,
      roundHistory: [],
      territoryResults: [],
      challengerTerritoriesWon: 0,
      opponentTerritoriesWon: 0,
      winnerPlayerId: null,
      loserPlayerId: null,
      winnerCrateRarity: null,
      createdAt: now,
      updatedAt: now,
      lastActionAt: now,
    };

    await saveMatch(match);
    await addPlayerMatch(challengerPlayerId, challengeId);

    return res.status(200).json({
      ok: true,
      challengeId,
      sharePath: `/faction-wars/challenge/${challengeId}`,
      match,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}
