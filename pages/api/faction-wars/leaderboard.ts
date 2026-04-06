// pages/api/faction-wars/leaderboard.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

const LB_FW_WARLORDS  = "ra:fw:lb:warlords";
const LB_FW_FACTIONS  = "ra:fw:lb:factions";
const LB_FW_STREAKS   = "ra:fw:lb:streaks";
const LB_FW_RICH      = "ra:fw:lb:rich";
const LB_FW_PERFECT   = "ra:fw:lb:perfect";
const FW_NAMES        = "ra:fw:player_names";
// Per-faction player win counts: ra:fw:faction:{fid} is a sorted set playerId -> wins
const FW_FACTION_LB   = (fid: string) => `ra:fw:faction:${fid}`;

async function topN(key: string, names: Record<string, string>, n = 50) {
  const raw = await redis.zrange(key, 0, n - 1, { rev: true, withScores: true });
  const out: { playerId: string; playerName?: string; score: number }[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const playerId = String(raw[i]);
    out.push({ playerId, playerName: names[playerId] || undefined, score: Number(raw[i + 1]) });
  }
  return out;
}

async function factionTopPlayers(fid: string, names: Record<string,string>, n = 10) {
  try {
    const raw = await redis.zrange(FW_FACTION_LB(fid), 0, n-1, { rev: true, withScores: true });
    const out: {playerId:string;playerName?:string;wins:number}[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      const playerId = String(raw[i]);
      out.push({ playerId, playerName: names[playerId]||undefined, wins: Number(raw[i+1]) });
    }
    return out;
  } catch { return []; }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const namesRaw = await redis.hgetall(FW_NAMES).catch(() => ({}));
    const names: Record<string, string> = (namesRaw as any) || {};
    const [warlords, streaks, rich, perfect] = await Promise.all([
      topN(LB_FW_WARLORDS, names),
      topN(LB_FW_STREAKS, names),
      topN(LB_FW_RICH, names),
      topN(LB_FW_PERFECT, names),
    ]);
    const factionRaw = await redis.zrange(LB_FW_FACTIONS, 0, 49, { rev: true, withScores: true });
    const factionIds: string[] = [];
    const factionWins: Record<string,number> = {};
    for (let i = 0; i < factionRaw.length; i += 2) {
      const fid = String(factionRaw[i]);
      factionIds.push(fid);
      factionWins[fid] = Number(factionRaw[i+1]);
    }
    // Get top players per faction in parallel
    const topPlayersArr = await Promise.all(factionIds.map(fid => factionTopPlayers(fid, names, 10)));
    const factions = factionIds.map((fid,i) => ({
      faction: fid,
      wins: factionWins[fid],
      topPlayers: topPlayersArr[i],
    }));
    return res.status(200).json({ ok: true, lb: { warlords, factions, streaks, rich, perfect } });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed" });
  }
}