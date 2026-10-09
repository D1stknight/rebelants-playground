import type { NextApiRequest, NextApiResponse } from "next";
import { createSoloCampaignService } from "../../../lib/server/raap-fwsolo";
import { createPlaygroundRaapSoloHandler } from "../../../lib/server/playground-raap-solo";

export const config = { api: { bodyParser: false }, maxDuration: 60 };
/** Opt-in only. Reuses the installed game keys, never a bot/Economy secret. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  const readKey = process.env.RAAP_PLAYGROUND_READ_KEY_HEX ?? "", actionKey = process.env.RAAP_PLAYGROUND_ACTION_KEY_HEX ?? "";
  const validUntil = Math.min(Number(process.env.RAAP_PLAYGROUND_ACTION_EXPIRES_AT_MS),
    Number(process.env.RAAP_PLAYGROUND_READ_EXPIRES_AT_MS), Number(process.env.RAAP_REBEL_CONNECTION_VALID_UNTIL) * 1000);
  const maximumAdditionalPoints = Number(process.env.RAAP_PLAYGROUND_SOLO_MAX_POINTS);
  if (process.env.RAAP_PLAYGROUND_SOLO_ACTIONS_ENABLED !== "true" || process.env.RAAP_REBEL_SOLO_ENABLED !== "true" ||
    !/^[0-9a-f]{64}$/.test(readKey) || !/^[0-9a-f]{64}$/.test(actionKey) || readKey === actionKey ||
    !Number.isSafeInteger(validUntil) || validUntil <= 0 || !Number.isSafeInteger(maximumAdditionalPoints) || maximumAdditionalPoints < 0)
    return res.status(503).json({ error: "PLAYGROUND_SOLO_UNCONFIGURED" });
  try {
    if (req.method !== "POST" || req.url !== "/api/raap/solo-action") throw Error();
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) { if (Array.isArray(value)) throw Error(); if (value !== undefined) headers.set(name, value); }
    if (headers.has("cookie") || headers.has("origin") || headers.has("content-encoding") || headers.get("content-type") !== "application/json") throw Error();
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 4096) return res.status(413).end(); chunks.push(Buffer.from(chunk)); }
    const { redis } = await import("../../../lib/server/redis");
    const service = createSoloCampaignService({ store: redis, now: () => Math.floor(Date.now() / 1000), validUntil: Math.floor(validUntil / 1000),
      send: async (effect, playerId, idem) => {
        const { spendREBEL, creditREBEL } = await import("../../../lib/server/fwpvp");
        return effect.direction === "DEBIT"
          ? spendREBEL(playerId, effect.amount, { idem, reason: effect.reason, metadata: { game: "faction-wars", mode: "SOLO" } })
          : creditREBEL(playerId, effect.amount, { idem, type: "game_reward", reason: effect.reason, metadata: { game: "faction-wars", mode: "SOLO" } });
      }, afterPoint: async (effect, playerId, balance) => {
        const { addToEarnedTotal, updateBalanceLeaderboard } = await import("../../../lib/server/leaderboards");
        if (effect.direction === "CREDIT") await addToEarnedTotal(playerId, effect.amount);
        await updateBalanceLeaderboard(playerId, balance);
      } });
    const run = createPlaygroundRaapSoloHandler({ readKey: Buffer.from(readKey, "hex"), actionKey: Buffer.from(actionKey, "hex"),
      collection: process.env.RAAP_PLAYGROUND_COLLECTION ?? "", validUntil, maximumAdditionalPoints, now: Date.now, store: redis, service });
    const response = await run(new Request("https://playground.invalid/api/raap/solo-action", { method: "POST", headers, body: Buffer.concat(chunks) }));
    response.headers.forEach((value, name) => res.setHeader(name, value));
    return res.status(response.status).send(await response.text());
  } catch { return res.status(403).json({ error: "PLAYGROUND_SOLO_UNAVAILABLE" }); }
}
