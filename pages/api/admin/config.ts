// pages/api/admin/config.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function isAdmin(req: NextApiRequest) {
  const token = req.headers["x-admin-token"];
  const provided = Array.isArray(token) ? token[0] : token;
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  return !!provided && provided === expected;
}

const CONFIG_KEY = "ra:config:points";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const { pointsConfig } = (req.body ?? {}) as { pointsConfig?: any };
    if (!pointsConfig || typeof pointsConfig !== "object") {
      return res.status(400).json({ ok: false, error: "Missing pointsConfig" });
    }

    // store override as JSON
    await redis.set(CONFIG_KEY, JSON.stringify(pointsConfig));

    return res.status(200).json({ ok: true, saved: pointsConfig });
  } catch (err: any) {
    console.error("admin config error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
