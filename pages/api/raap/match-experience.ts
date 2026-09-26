import type { NextApiRequest, NextApiResponse } from "next";
import { createPlaygroundPlayerConnection } from "../../../lib/server/raap-player-connection";
import { readPlaygroundCompletedExperience } from "../../../lib/server/raap-fwpvp-experience";
import { configuredPlaygroundMatchSource, deliverPlaygroundMatchFact } from "../../../lib/server/raap-match-source";

export const config = { api: { bodyParser: false } };

/** Owner-only review of an actual selected-player match, not client scores or
 * permission to award a badge. Optional fact signing never selects a reward. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const keys = [process.env.RAAP_REBEL_SELECTION_KEY_HEX, process.env.RAAP_REBEL_HANDOFF_KEY_HEX, process.env.RAAP_REBEL_COOKIE_KEY_HEX];
  const raapOrigin = process.env.RAAP_REBEL_ORIGIN, playgroundOrigin = process.env.RAAP_REBEL_PLAYGROUND_ORIGIN;
  const validUntil = Number(process.env.RAAP_REBEL_CONNECTION_VALID_UNTIL), now = () => Math.floor(Date.now() / 1000);
  if (process.env.RAAP_REBEL_MATCH_RECORDING_ENABLED !== "true" || process.env.RAAP_REBEL_CONNECTION_ENABLED !== "true" ||
    !raapOrigin || !playgroundOrigin || keys.some(key => !key || !/^[0-9a-f]{64}$/.test(key)) || !Number.isSafeInteger(validUntil) || now() >= validUntil)
    return res.status(503).json({ error: "PLAYGROUND_MATCH_UNCONFIGURED" });
  let connection: ReturnType<typeof createPlaygroundPlayerConnection> | undefined;
  let source: ReturnType<typeof configuredPlaygroundMatchSource>;
  try {
    if (req.method !== "POST" || req.url !== "/api/raap/match-experience" || req.headers.origin !== playgroundOrigin ||
      req.headers["sec-fetch-site"] !== "same-origin" || req.headers["content-type"] !== "application/json" || req.headers["content-encoding"]) throw Error();
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 1024) return res.status(413).end(); chunks.push(Buffer.from(chunk)); }
    const body = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (!body || Object.keys(body).sort().join() !== "challengeId,playerId" ||
      typeof body.challengeId !== "string" || !/^[a-z0-9]{12}$/.test(body.challengeId) || typeof body.playerId !== "string" || body.playerId.length > 64) throw Error();
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) { if (Array.isArray(value)) throw Error(); if (value !== undefined) headers.set(key, value); }
    connection = createPlaygroundPlayerConnection({ raapOrigin, playgroundOrigin, validUntil, now,
      key: Buffer.from(keys[0]!, "hex"), handoffKey: Buffer.from(keys[1]!, "hex"), cookieKey: Buffer.from(keys[2]!, "hex") });
    const selection = await connection.authenticatePlayer(new Request(playgroundOrigin + req.url, { method: "POST", headers }), body.playerId);
    const { redis } = await import("../../../lib/server/redis.js");
    const snapshot = await readPlaygroundCompletedExperience({ challengeId: body.challengeId, playerId: body.playerId, selection, now, store: redis });
    source = configuredPlaygroundMatchSource(process.env, redis, true);
    const fact = source ? await source.issue(body.challengeId, body.playerId, selection.selectionId) : undefined;
    let history: { status: "RECORDED" | "NOT_CONFIRMED"; lifeRecorded: boolean } | undefined;
    if (fact && source && process.env.RAAP_REBEL_MATCH_DELIVERY_ENABLED === "true") {
      try { history = await deliverPlaygroundMatchFact({ raapOrigin,
        body: source.deliveryRequest(fact, playgroundOrigin) }); }
      catch { history = { status: "NOT_CONFIRMED", lifeRecorded: false }; }
    }
    if (now() >= validUntil || now() >= selection.validUntil) throw Error();
    return res.status(200).json({ snapshot, ...(fact ? { fact } : {}), ...(history ? { history } : {}) });
  } catch { return res.status(403).json({ error: "PLAYGROUND_MATCH_UNAVAILABLE" }); }
  finally { connection?.close(); source?.close(); }
}
