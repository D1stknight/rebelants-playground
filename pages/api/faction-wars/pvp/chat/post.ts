// POST /api/faction-wars/pvp/chat/post
//
// Authenticated user posts a message to a match's chat room. Rate-limit and
// mute checks live in postChatMessage(). Role (challenger/opponent/spectator)
// is computed server-side from the match record so a player can't spoof it.

import type { NextApiRequest, NextApiResponse } from "next";
import {
  getMatch,
  getPvpEconomyConfig,
  postChatMessage,
  chatRoleForPlayer,
} from "../../../../../lib/server/fwpvp";
import type { PostChatRequest } from "../../../../../lib/types/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as Partial<PostChatRequest>;
    const challengeId = String(body.challengeId || "").trim().slice(0, 64);
    const playerId = String(body.playerId || "").trim().slice(0, 64);
    const displayName = String(body.displayName || "").trim().slice(0, 32);
    const text = String(body.text || "");

    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing challengeId" });
    if (!playerId) return res.status(400).json({ ok: false, error: "Sign in to chat" });
    if (!displayName) return res.status(400).json({ ok: false, error: "Missing displayName" });
    if (!text.trim()) return res.status(400).json({ ok: false, error: "Message cannot be empty" });

    const [match, cfg] = await Promise.all([getMatch(challengeId), getPvpEconomyConfig()]);
    if (!match) return res.status(404).json({ ok: false, error: "Match not found" });
    if (!cfg.factionWarsChatEnabled) {
      return res.status(403).json({ ok: false, error: "Chat is currently disabled" });
    }

    const role = chatRoleForPlayer(match, playerId);
    const result = await postChatMessage({ challengeId, playerId, displayName, text, role });
    if (!result.ok) {
      // Surface mute info so the client can render the explicit "muted until X" banner.
      return res.status(403).json({ ok: false, error: result.error, mute: (result as any).mute ?? null });
    }
    return res.status(200).json({ ok: true, message: result.message });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "post failed" });
  }
}
