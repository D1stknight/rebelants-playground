// POST /api/faction-wars/pvp/chat/post
//
// A signed-in player posts a message to a match's chat room. Who posts and the
// name shown come from the player's signed session (lib/server/player-auth.ts),
// never from the request body: the body's playerId only chooses between the
// player's own signed ids, so nobody can post as someone else or step around a
// mute by sending another id. Guests read along but don't post. Rate-limit and
// mute checks live in postChatMessage(). Role (challenger/opponent/spectator)
// is computed server-side from the match record so a player can't spoof it.

import type { NextApiRequest, NextApiResponse } from "next";
import {
  getMatch,
  getPvpEconomyConfig,
  postChatMessage,
  chatRoleForPlayer,
} from "../../../../../lib/server/fwpvp";
import { actingPlayer } from "../../../../../lib/server/player-auth";
import { DISCORD_SESSION_COOKIE, verifyDiscordSession } from "../../../../../lib/player-session";
import { readCookie, type ResolvedUser } from "../../../../../lib/economy";
import { redis } from "../../../../../lib/server/redis";
import type { PostChatRequest } from "../../../../../lib/types/fwpvp";

// The name the room shows: the Discord name the signed session carries, a commander
// name as it was claimed, else the Rebel Economy's name for the account.
async function shownName(req: NextApiRequest, playerId: string, user: ResolvedUser): Promise<string> {
  if (playerId.startsWith("discord:")) {
    const d = verifyDiscordSession(readCookie(req, DISCORD_SESSION_COOKIE));
    if (d && `discord:${d.discordUserId}` === playerId && d.discordName.trim()) return d.discordName.trim();
  }
  if (playerId.startsWith("name:")) {
    try {
      const v: any = await redis.get(`ra:commander:player:${playerId}`);
      if (typeof v === "string" && v.trim()) return v.trim();
    } catch {}
  }
  const econ = String(user?.displayName || "").trim();
  if (econ) return econ;
  if (playerId.startsWith("wallet:")) return `${playerId.slice(7, 13)}…${playerId.slice(-4)}`;
  return playerId.split(":").pop() || "Player";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as Partial<PostChatRequest>;
    const challengeId = String(body.challengeId || "").trim().slice(0, 64);
    const text = String(body.text || "");

    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing challengeId" });
    if (!text.trim()) return res.status(400).json({ ok: false, error: "Message cannot be empty" });

    const acting = await actingPlayer(req, body.playerId);
    if (!acting.ok) {
      return res.status(401).json({ ok: false, error: acting.signIn ? "Sign in again to chat." : "Sign in to chat.", signIn: acting.signIn });
    }
    const playerId = acting.playerId;

    const [match, cfg] = await Promise.all([getMatch(challengeId), getPvpEconomyConfig()]);
    if (!match) return res.status(404).json({ ok: false, error: "Match not found" });
    if (!cfg.factionWarsChatEnabled) {
      return res.status(403).json({ ok: false, error: "Chat is currently disabled" });
    }

    const displayName = (await shownName(req, playerId, acting.user)).slice(0, 32);
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
