// pages/api/points/claim.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { pointsConfig as defaultPointsConfig } from "../../../lib/pointsConfig";

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

function claimKey(playerId: string) {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `ra:points:claimed:${playerId}:${yyyy}-${mm}-${dd}`;
}

// ✅ get LIVE config (Admin -> Redis) via /api/config, fallback to defaults
async function getLivePointsConfig(req: NextApiRequest) {
  try {
    const proto = (req.headers["x-forwarded-proto"] as string) || "http";
    const host = req.headers.host;
    const url = `${proto}://${host}/api/config`;

    const r = await fetch(url, { method: "GET", headers: { "Cache-Control": "no-store" } });
    const j: any = await r.json().catch(() => null);

    if (r.ok && j?.pointsConfig) {
      return { ...defaultPointsConfig, ...j.pointsConfig };
    }
  } catch {
    // ignore
  }
  return defaultPointsConfig;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    const playerId =
      String((req.method === "GET" ? req.query.playerId : (req.body ?? {}).playerId) || "guest")
        .trim()
        .slice(0, 64) || "guest";

    const key = claimKey(playerId);

    // ✅ GET = status only (claimed today?) + next claim timer
    if (req.method === "GET") {
      const exists = await redis.get<number>(key);

      const now = new Date();
      const nextUtcMidnight = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() + 1,
          0,
          0,
          0,
          0
        )
      );

      const nextClaimAt = nextUtcMidnight.toISOString();
      const msUntilNextClaim = Math.max(0, nextUtcMidnight.getTime() - now.getTime());

      return res.status(200).json({
        ok: true,
        playerId,
        claimed: !!exists,
        nextClaimAt,
        msUntilNextClaim,
      });
    }

    // ✅ POST = attempt claim (server enforces once/day)
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const requested = Math.floor(Number(body.amount || 0));

    // server decides the claim amount (use live config)
    const liveCfg = await getLivePointsConfig(req);
    const dailyClaim = Math.floor(Number((liveCfg as any).dailyClaim || 0));

    const amount = dailyClaim > 0 ? dailyClaim : Math.max(0, requested);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid dailyClaim config" });
    }

    // ✅ once-per-day guard (atomic)
    // SETNX-like: only set if not exists
    const set = await redis.set(key, 1, { nx: true, ex: 60 * 60 * 48 }); // keep 48h

    if (!set) {
      // already claimed today
      const balNowRaw = await redis.get<number>(balKey(playerId));
      const balNow = Number(balNowRaw || 0);
      return res.status(409).json({
        ok: false,
        error: "already_claimed",
        playerId,
        claimed: true,
        alreadyClaimed: true,
        added: 0,
        balance: balNow,
      });
    }

    // ✅ credit balance
    const newBal = await redis.incrby(balKey(playerId), amount);

    return res.status(200).json({
      ok: true,
      playerId,
      claimed: true,
      alreadyClaimed: false,
      added: amount,
      balance: Number(newBal || 0),
    });
  } catch (e: any) {
    console.error("claim error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
