// POST /api/faction-wars/tournament/create
//
// Admin-only. Creates a draft tournament. Players can then join it via
// /api/faction-wars/tournament/join. Once size players have joined (or the
// admin decides to start with fewer), admin calls seed.ts.

import type { NextApiRequest, NextApiResponse } from "next";
import {
  generateTournamentId,
  saveTournament,
  validateTournamentConfig,
  checkAdminAuth,
  getPvpEconomyConfig,
} from "../../../../lib/server/fwpvp";
import type { Tournament, CreateTournamentRequest } from "../../../../lib/types/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  if (!checkAdminAuth(req)) return res.status(401).json({ ok: false, error: "unauthorized" });

  const body = (req.body || {}) as CreateTournamentRequest;
  const econCfg = await getPvpEconomyConfig();
  if (!econCfg.factionWarsTournamentEnabled) {
    return res.status(403).json({ ok: false, error: "tournaments disabled" });
  }

  const name = String(body.name || "").trim().slice(0, 60) || "Untitled Tournament";
  const size = Number(body.size) || econCfg.factionWarsTournamentMaxSize;
  const entryFee = Number.isFinite(body.entryFee)
    ? Math.max(0, Number(body.entryFee))
    : econCfg.factionWarsTournamentDefaultFee;
  const potPerRound = Array.isArray(body.potPerRound) && body.potPerRound.length > 0
    ? body.potPerRound.map((p: any) => Math.max(0, Number(p) || 0))
    : (econCfg.factionWarsTournamentDefaultPots as number[]);

  const validation = validateTournamentConfig({
    size,
    entryFee,
    potPerRound,
    maxSize: econCfg.factionWarsTournamentMaxSize,
  });
  if (!validation.ok) {
    return res.status(400).json({ ok: false, error: validation.error });
  }

  const id = generateTournamentId();
  const now = Date.now();
  const tournament: Tournament = {
    id,
    status: "draft",
    name,
    size,
    entryFee,
    potPerRound,
    participants: [],
    rounds: [],
    championPlayerId: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
  };
  await saveTournament(tournament);

  return res.status(200).json({ ok: true, tournament });
}
