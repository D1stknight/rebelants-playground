// pages/api/shuffle/status.ts — favor meter + daily Royal Egg availability for the lobby
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { FAVOR_KEY, ROYAL_KEY, dayKey, loadCfg } from "./start";
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const playerId = String(req.query.playerId || "guest").trim().slice(0, 64) || "guest";
    const cfg = await loadCfg();
    const favor = Number((await redis.get(FAVOR_KEY(playerId))) || 0);
    const royalEnabled = cfg.shuffleRoyalEnabled !== false;
    const royalReady = royalEnabled && !(await redis.get(ROYAL_KEY(playerId, dayKey())));
    return res.status(200).json({ ok: true, favor, favorMax: Math.max(1, Number(cfg.shuffleFavorPity ?? 5)), royalReady });
  } catch (e) { return res.status(500).json({ ok: false, error: "Server error" }); }
}
