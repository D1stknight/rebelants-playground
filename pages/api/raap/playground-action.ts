import type { NextApiRequest, NextApiResponse } from "next";
import { createPlaygroundActions } from "../../../lib/server/raap-pvp-actions";
import { createPlaygroundRaapActionsHandler } from "../../../lib/server/playground-raap-actions";
export const config = { api: { bodyParser: false } };
/** Unconfigured by default. Never reuse the read, bot or Economy credential. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  const key = process.env.RAAP_PLAYGROUND_ACTION_KEY_HEX ?? "", collection = process.env.RAAP_PLAYGROUND_COLLECTION ?? "";
  const validUntil = Number(process.env.RAAP_PLAYGROUND_ACTION_EXPIRES_AT_MS);
  if (process.env.RAAP_PLAYGROUND_COORDINATION_ENABLED !== "true" || !/^[0-9a-f]{64}$/.test(key) ||
    !/^0x[0-9a-f]{40}$/.test(collection) || !Number.isSafeInteger(validUntil) || validUntil <= 0 ||
    key === process.env.RAAP_PLAYGROUND_READ_KEY_HEX) return res.status(503).json({ error: "PLAYGROUND_ACTION_UNCONFIGURED" });
  try {
    const headers = new Headers();
    for (const [k,v] of Object.entries(req.headers)) { if (Array.isArray(v)) throw Error(); if (v !== undefined) headers.set(k,v); }
    if (req.method !== "POST" || req.url !== "/api/raap/playground-action" || headers.get("content-type") !== "application/json" ||
      headers.has("cookie") || headers.has("origin") || headers.has("content-encoding")) throw Error();
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > 4096) return res.status(413).end(); chunks.push(Buffer.from(chunk)); }
    const [{ redis }, game, {submitPvpMove}] = await Promise.all([import("../../../lib/server/redis.js"), import("../../../lib/server/fwpvp.js"),
      import("../faction-wars/pvp/submit-move.js")]);
    const submitMove = async (challengeId: string, playerId: string, moveId: string) => {
      let status = 500, result: {ok?:boolean;match?:import("../../../lib/types/fwpvp").PvpMatch} = {};
      const response = {setHeader(){},status(code:number){status=code;return this;},json(value:typeof result){result=value;return this;}};
      await submitPvpMove({method:"POST",body:{challengeId,playerId,moveId}} as NextApiRequest,response as unknown as NextApiResponse);
      return {status,ok:result.ok===true,match:result.match};
    };
    const run = createPlaygroundRaapActionsHandler({ key: Buffer.from(key,"hex"), collection, validUntil, now: Date.now,
      actions: createPlaygroundActions({ store: redis, game: {...game,submitMove}, now: Date.now, validUntil }) });
    const reply = await run(new Request("https://playground.invalid/api/raap/playground-action", { method: "POST", headers, body: Buffer.concat(chunks) }));
    reply.headers.forEach((v,k) => res.setHeader(k,v)); return res.status(reply.status).send(await reply.text());
  } catch { return res.status(403).json({ error: "PLAYGROUND_ACTION_UNAVAILABLE" }); }
}
