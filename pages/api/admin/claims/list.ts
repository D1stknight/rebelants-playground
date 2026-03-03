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
  if (!expected) return false;

  return !!provided && provided === expected;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const match = "ra:claim:*";
    const rAny: any = redis as any;

    let keys: string[] = [];

    // Prefer SCAN if available (safer than KEYS on large DBs)
    if (typeof rAny.scan === "function") {
      let cursor = 0;
      for (let i = 0; i < 50; i++) {
        const out = await rAny.scan(cursor, { match, count: 200 });
        // Upstash returns [cursor, keys] OR { cursor, keys }
        if (Array.isArray(out)) {
          cursor = Number(out[0] ?? 0);
          const batch = Array.isArray(out[1]) ? out[1] : [];
          keys.push(...batch);
        } else if (out && typeof out === "object") {
          cursor = Number(out.cursor ?? 0);
          const batch = Array.isArray(out.keys) ? out.keys : [];
          keys.push(...batch);
        } else {
          break;
        }
        if (!cursor) break;
      }
    } else if (typeof rAny.keys === "function") {
      keys = await rAny.keys(match);
    } else {
      return res.status(500).json({
        ok: false,
        error: "Redis client has no scan() or keys() method",
      });
    }

        // Filter ONLY real claim keys (exclude locks like :transferLock)
    const claimKeys = (keys || [])
      .filter((k) => k.startsWith("ra:claim:") && !k.endsWith(":transferLock"))
      .sort()
      .reverse();

    // Don’t return a giant payload
    const slice = claimKeys.slice(0, 200);

    // Fetch claim payloads
    const rAny2: any = redis as any;

    let values: any[] = [];
    if (typeof rAny2.mget === "function") {
      values = await rAny2.mget(...slice);
    } else {
      values = await Promise.all(slice.map((k) => redis.get(k)));
    }

    const claims = slice.map((key, idx) => {
      const claimId = key.replace("ra:claim:", "");
      const raw = values?.[idx];

      if (!raw) return { claimId, missing: true };

      // Upstash may return a string OR already-parsed object depending on client behavior
      const obj =
        typeof raw === "string"
          ? (() => {
              try {
                return JSON.parse(raw);
              } catch {
                return { claimId, raw };
              }
            })()
          : raw;

      return obj?.claimId ? obj : { claimId, ...obj };
    });

    return res.status(200).json({
      ok: true,
      count: claimKeys.length,
      claimIds: slice.map((k) => k.replace("ra:claim:", "")),
      claims,
    });
  } catch (e: any) {
    console.error("admin claims list error:", e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "Server error",
    });
  }
}
