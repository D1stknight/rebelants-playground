import type { NextApiRequest, NextApiResponse } from "next";
import { createPlaygroundPlayerConnection } from "../../../lib/server/raap-player-connection";
export const config = { api: { bodyParser: false } };

/** Separate optional app connection. No borrowed Economy/browser-login secrets,
 * no game store imports and no activation from importing the route. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  const keys = [process.env.RAAP_REBEL_SELECTION_KEY_HEX, process.env.RAAP_REBEL_HANDOFF_KEY_HEX, process.env.RAAP_REBEL_COOKIE_KEY_HEX];
  const raapOrigin = process.env.RAAP_REBEL_ORIGIN, playgroundOrigin = process.env.RAAP_REBEL_PLAYGROUND_ORIGIN;
  const validUntil = Number(process.env.RAAP_REBEL_CONNECTION_VALID_UNTIL);
  if (process.env.RAAP_REBEL_CONNECTION_ENABLED !== "true" || !raapOrigin || !playgroundOrigin ||
    keys.some(key => !key || !/^[0-9a-f]{64}$/.test(key)) || !Number.isSafeInteger(validUntil) || Date.now() / 1000 >= validUntil)
    return res.status(503).json({ error: "PLAYGROUND_CONNECTION_UNCONFIGURED" });
  let connection: ReturnType<typeof createPlaygroundPlayerConnection> | undefined;
  try {
    if (req.url !== "/api/raap/connection" || !["POST", "GET", "DELETE"].includes(req.method ?? "")) return res.status(403).end();
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) { if (Array.isArray(value)) throw Error(); if (value !== undefined) headers.set(key, value); }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 1024) return res.status(413).end(); chunks.push(Buffer.from(chunk)); }
    if (req.method !== "POST" && size) return res.status(403).end();
    connection = createPlaygroundPlayerConnection({ raapOrigin, playgroundOrigin, validUntil,
      key: Buffer.from(keys[0]!, "hex"), handoffKey: Buffer.from(keys[1]!, "hex"), cookieKey: Buffer.from(keys[2]!, "hex"),
      now: () => Math.floor(Date.now() / 1000) });
    const response = await connection.handle(new Request(playgroundOrigin + req.url, { method: req.method, headers,
      ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}) }));
    response.headers.forEach((value, key) => res.setHeader(key, value));
    return res.status(response.status).send(await response.text());
  } catch { return res.status(403).json({ error: "PLAYGROUND_CONNECTION_UNAVAILABLE" }); }
  finally { connection?.close(); }
}
