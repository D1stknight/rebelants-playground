// GET /api/faction-wars/pvp/chat/messages?id={challengeId}&playerId={pid}
//
// Returns chat messages + the requesting player's mute status (if any). The
// playerId param is optional — anonymous viewers get messages but no myMute.
//
// Public endpoint. Read-only. No auth required.

import type { NextApiRequest, NextApiResponse } from "next";
import {
  getChatMessages,
  getMute,
  getPvpEconomyConfig,
} from "../../../../../lib/server/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const challengeId = String(req.query.id || "").trim().slice(0, 64);
    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing id" });
    const playerId = req.query.playerId ? String(req.query.playerId).trim().slice(0, 64) : "";

    const [messages, cfg, myMute] = await Promise.all([
      getChatMessages(challengeId),
      getPvpEconomyConfig(),
      playerId ? getMute(challengeId, playerId) : Promise.resolve(null),
    ]);
    return res.status(200).json({
      ok: true,
      enabled: cfg.factionWarsChatEnabled,
      messages,
      myMute: myMute ?? null,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "messages failed" });
  }
}
