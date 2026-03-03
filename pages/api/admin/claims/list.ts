// pages/api/admin/claims/list.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../../lib/server/redis";

function headerValue(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function isAdmin(req: NextApiRequest) {
  const provided =
    headerValue(req.headers["x-admin-key"]) ||
    headerValue(req.headers["x-admin-token"]) ||
    "";
  const expected = process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || "";
  return !!expected && !!provided && provided === expected;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

    // Upstash scan
    let cursor = 0;
    const out: any[] = [];

    do {
      const resp = await redis.scan(cursor, { match: "ra:claim:*", count: 200 });
      cursor = Number((resp as any)?.cursor ?? 0);
      const keys = ((resp as any)?.keys ?? []) as string[];

      for (const k of keys) {
        // skip lock keys
        if (k.endsWith(":transferLock")) continue;

        const raw = await redis.get<string>(k);
        if (!raw) continue;

        let claim: any = null;
        try {
          claim = JSON.parse(String(raw));
        } catch {
          claim = null;
        }
        if (!claim) continue;

        out.push(claim);
      }
    } while (cursor !== 0);

    // newest first
    out.sort((a, b) => Number(b?.ts || 0) - Number(a?.ts || 0));

    return res.status(200).json({ ok: true, count: out.length, claims: out.slice(0, 200) });
  } catch (e: any) {
    console.error("admin claims list error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
