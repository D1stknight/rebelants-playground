// pages/api/admin/commander-names.ts
// Commander names from before PINs (lib/commanderPins.ts): nothing proves who claimed one, so the team sets
// its first PIN after checking (pages/api/commander/set-pin.ts with the admin key). GET lists them.
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { isAdminRequest } from "../../../lib/server/player-auth";

const PREFIX = "ra:commander:name:";
const MAX_NAMES = 20000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (!isAdminRequest(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const slugs: string[] = [];
    let cursor = "0", truncated = false;
    do {
      const page = (await redis.scan(cursor, { match: PREFIX + "*", count: 500 })) as [string | number, string[]];
      for (const k of page[1]) slugs.push(String(k).slice(PREFIX.length));
      cursor = String(page[0]);
      if (slugs.length >= MAX_NAMES) { truncated = true; break; }
    } while (cursor !== "0");
    const withoutPin: { name: string; shown: string | null }[] = [];
    for (let i = 0; i < slugs.length; i += 100) {
      const part = slugs.slice(i, i + 100);
      const pins = await redis.mget<unknown[]>(...part.map((s) => `ra:commander:pin:${s}`));
      const missing = part.filter((_, j) => pins[j] === null || pins[j] === undefined || pins[j] === "");
      if (!missing.length) continue;
      const shown = await redis.mget<unknown[]>(...missing.map((s) => `ra:commander:player:name:${s}`));
      missing.forEach((s, j) => withoutPin.push({ name: s, shown: shown[j] == null ? null : String(shown[j]) }));
    }
    withoutPin.sort((a, b) => a.name.localeCompare(b.name));
    return res.status(200).json({ ok: true, names: slugs.length, truncated, withoutPin });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
