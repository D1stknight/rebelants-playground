import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function headerValue(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function isAuthed(req: NextApiRequest) {
  const provided =
    headerValue(req.headers["x-admin-key"]) ||
    headerValue(req.headers["x-admin-token"]) ||
    "";

  const expected = process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || "";
  if (!expected) return false;

  return !!provided && provided === expected;
}

// ✅ Match earn.ts EXACTLY: daily earned key is date-based
function todayKey(playerId: string) {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `ra:points:earned:${playerId}:${yyyy}-${mm}-${dd}`;
}

// ✅ Back-compat fallback (older key if it exists)
function legacyEarnedTodayKey(playerId: string) {
  return `ra:points:earnedToday:${playerId}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!isAuthed(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const playerId = String(body.playerId || "guest").trim().slice(0, 64) || "guest";

    const kToday = todayKey(playerId);
    const kLegacy = legacyEarnedTodayKey(playerId);

    await redis.del(kToday);
    await redis.del(kLegacy);

    return res.status(200).json({
      ok: true,
      playerId,
      deleted: [kToday, kLegacy],
    });
  } catch (e: any) {
    console.error("reset-earned error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
