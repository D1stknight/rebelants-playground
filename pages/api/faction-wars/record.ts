// pages/api/faction-wars/record.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { addToEarnedTotal, updateBalanceLeaderboard } from "../../../lib/server/leaderboards";

const LB_FW_WARLORDS  = "ra:fw:lb:warlords";
const LB_FW_FACTIONS  = "ra:fw:lb:factions";
const LB_FW_STREAKS   = "ra:fw:lb:streaks";
const LB_FW_RICH      = "ra:fw:lb:rich";
const LB_FW_PERFECT   = "ra:fw:lb:perfect";
const FW_NAMES        = "ra:fw:player_names";
const FW_STREAK_KEY   = (pid: string) => `ra:fw:streak:${pid}`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const playerId       = String(body.playerId    || "guest").trim().slice(0, 64) || "guest";
    const playerName     = String(body.playerName  || "").trim().slice(0, 64);
    const rarity         = String(body.rarity      || "none");
    const pointsAwarded  = Number(body.pointsAwarded || 0);
    const territoriesWon = Number(body.territoriesWon || 0);
    const team: string[] = Array.isArray(body.team) ? body.team : [];
    const perfect        = !!body.perfect;
    if (playerName) await redis.hset(FW_NAMES, { [playerId]: playerName }).catch(() => {});
    if (territoriesWon > 0) await redis.zincrby(LB_FW_WARLORDS, territoriesWon, playerId);
    if (rarity !== "none" && team.length > 0) {
      for (const fid of team) await redis.zincrby(LB_FW_FACTIONS, 1, fid);
    }
    const streakKey = FW_STREAK_KEY(playerId);
    if (rarity !== "none") {
      const newStreak = await redis.incr(streakKey);
      await redis.expire(streakKey, 60 * 60 * 24 * 30);
      const current = await redis.zscore(LB_FW_STREAKS, playerId).catch(() => 0);
      if (newStreak > Number(current || 0)) await redis.zadd(LB_FW_STREAKS, { score: newStreak, member: playerId });
    } else {
      await redis.set(streakKey, 0);
    }
    if (pointsAwarded > 0) {
      await redis.zincrby(LB_FW_RICH, pointsAwarded, playerId);
      await addToEarnedTotal(playerId, pointsAwarded);
    }
    if (perfect) await redis.zincrby(LB_FW_PERFECT, 1, playerId);
    try {
      const proto = (req.headers["x-forwarded-proto"] as string) || "http";
      const host  = req.headers.host;
      const balR  = await fetch(`${proto}://${host}/api/points/balance?playerId=${encodeURIComponent(playerId)}`, { cache: "no-store" });
      const balJ: any = await balR.json().catch(() => null);
      if (balJ?.balance != null) await updateBalanceLeaderboard(playerId, Number(balJ.balance));
    } catch {}
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed" });
  }
}