import { withPlaygroundMatchExperience } from "../../../../lib/server/raap-fwpvp-experience";
// POST /api/faction-wars/pvp/heal
//
// Allows a player to spend REBEL to restore HP during their turn. Mirrors
// the AI mode heal exactly: same admin config keys (factionWarsHealCost,
// factionWarsHealAmt, factionWarsHealMax), same restore semantics.
//
// Why "during their turn" only? Simplifies edge cases. AI mode allows heal
// any time because there's no concurrent state to clash with — but in PvP
// constraining heal to your own turn means we don't have to handle "heal
// arrives during opponent's submit-move" race conditions. UX-wise this is
// fine: the player can heal, then play their move.
//
// Validates server-side (do not trust the client):
//   - match exists and is "active"
//   - playerId is a participant
//   - it's currently this player's turn
//   - currentHp < MAX_HP (don't waste REBEL on a no-op)
//   - healsUsed < factionWarsHealMax
//   - balance >= factionWarsHealCost
//
// On success: spends REBEL atomically, increments HP (capped at MAX_HP),
// increments healsUsed, returns updated match + new balance.

import type { NextApiRequest, NextApiResponse } from "next";
import {
  getMatch,
  saveMatch,
  spendREBEL,
  getREBELBalance,
  getHealConfig,
} from "../../../../lib/server/fwpvp";
import { inspectPvpHeal, quotePvpHeal, applyPvpHeal, PvpRuleError } from "../../../../lib/server/fwpvp-rules";
import type { PvpMatch } from "../../../../lib/types/fwpvp";

interface HealRequest {
  challengeId?: string;
  playerId?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as HealRequest;
    const challengeId = String(body.challengeId || "").trim().slice(0, 64);
    const playerId = String(body.playerId || "").trim().slice(0, 64);

    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing challengeId" });
    if (!playerId) return res.status(400).json({ ok: false, error: "Missing playerId" });

    const match: PvpMatch | null = await getMatch(challengeId);
    if (!match) return res.status(404).json({ ok: false, error: "Match not found" });
    inspectPvpHeal(match, playerId);
    const healCfg = await getHealConfig();
    const { cost } = quotePvpHeal(match, playerId, healCfg);
    if (cost > 0) {
      const bal = await getREBELBalance(playerId);
      if (bal < cost) {
        return res.status(400).json({
          ok: false,
          error: `Insufficient REBEL. Need ${cost}, have ${bal}.`,
          balance: bal,
          required: cost,
        });
      }
      const newBal = await spendREBEL(playerId, cost);
      if (newBal === null) {
        return res.status(400).json({ ok: false, error: "Could not deduct heal cost (try again)" });
      }
    }

    const result = applyPvpHeal(match, playerId, healCfg, Date.now());
    await saveMatch(result.match);

    const newBalance = await getREBELBalance(playerId);
    return res.status(200).json({
      ok: true,
      ...result,
      balance: newBalance,
    });
  } catch (e: any) {
    if (e instanceof PvpRuleError) return res.status(e.status).json({ ok: false, error: e.message });
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}

export default withPlaygroundMatchExperience("heal", handler);
