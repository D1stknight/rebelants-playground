import type { NextApiRequest, NextApiResponse } from "next";
import { createHmac, timingSafeEqual } from "node:crypto";
import { configuredPlaygroundMatchSource } from "../../../lib/server/raap-match-source";
export const config = { api: { bodyParser: false } };

/** Authenticated read for RAAP's existing source-admission port. Never issues
 * a new receipt or accepts a submitted game result, selection or XP amount. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
  const secret = process.env.RAAP_REBEL_FACT_READ_KEY_HEX, end = Number(process.env.RAAP_REBEL_CONNECTION_VALID_UNTIL);
  const now = () => Math.floor(Date.now() / 1000);
  if (process.env.RAAP_REBEL_MATCH_SOURCE_ENABLED !== "true" || !secret || !/^[0-9a-f]{64}$/.test(secret) ||
    /^0+$/.test(secret) || !Number.isSafeInteger(end) || now() >= end)
    return res.status(503).json({ error: "PLAYGROUND_MATCH_SOURCE_UNCONFIGURED" });
  let source: ReturnType<typeof configuredPlaygroundMatchSource>;
  const key = Buffer.from(secret, "hex");
  try {
    if (req.method !== "POST" || req.url !== "/api/raap/match-source" || req.headers["content-type"] !== "application/json" ||
      req.headers.cookie || req.headers.origin || req.headers["content-encoding"]) throw Error();
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 1024) return res.status(413).end(); chunks.push(Buffer.from(chunk)); }
    const bytes = Buffer.concat(chunks), signature = req.headers["x-raap-auth"];
    if (typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature, "hex"),
      createHmac("sha256", key).update("raap.playground.match-source.v1\0").update(bytes).digest())) throw Error();
    const body = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
    if (!body || Object.keys(body).sort().join() !== "issuedAt,nonce,sourceActivityDigest,validUntil" ||
      typeof body.sourceActivityDigest !== "string" || !/^0x[0-9a-f]{64}$/.test(body.sourceActivityDigest) ||
      typeof body.nonce !== "string" || !/^[0-9a-f]{64}$/.test(body.nonce) ||
      !Number.isSafeInteger(body.issuedAt) || !Number.isSafeInteger(body.validUntil) || body.issuedAt > now() ||
      body.issuedAt < 1 || body.validUntil > body.issuedAt + 30 || body.validUntil > end || now() >= body.validUntil) throw Error();
    const { redis } = await import("../../../lib/server/redis.js");
    source = configuredPlaygroundMatchSource(process.env, redis, false);
    if (!source) throw Error();
    const fact = await source!.read(body.sourceActivityDigest);
    if (now() >= body.validUntil || now() >= end) throw Error();
    return res.status(200).json({ fact: fact ?? null, nonce: body.nonce, observedAt: now() });
  } catch { return res.status(403).json({ error: "PLAYGROUND_MATCH_SOURCE_UNAVAILABLE" }); }
  finally { key.fill(0); source?.close(); }
}
