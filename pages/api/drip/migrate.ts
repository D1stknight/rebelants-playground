// pages/api/drip/migrate.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function getBaseUrl(req: NextApiRequest) {
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  const host = req.headers.host;
  return `${proto}://${host}`;
}

async function getDiscordSession(req: NextApiRequest) {
  const base = getBaseUrl(req);
  const r = await fetch(`${base}/api/auth/discord/session`, {
    method: "GET",
    headers: {
      cookie: req.headers.cookie || "",
      "Cache-Control": "no-store",
    },
  });
  const j: any = await r.json().catch(() => null);
  return { ok: r.ok && j?.ok, data: j };
}

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}
function lbBalanceKey() {
  return `ra:lb:balance`;
}

// ✅ idempotency key in Redis
function idemKey(discordUserId: string, idempotencyKey: string) {
  return `ra:drip:migrate:idem:${discordUserId}:${idempotencyKey}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const apiKey = process.env.DRIP_API_KEY || "";
    const realmId = process.env.DRIP_REALM_ID || "";
    const realmPointId = process.env.DRIP_REALM_POINT_ID || ""; // optional

    if (!apiKey || !realmId) {
      return res.status(500).json({
        ok: false,
        error: "Missing DRIP_API_KEY or DRIP_REALM_ID in env vars.",
      });
    }

    const sess = await getDiscordSession(req);
    if (!sess.ok || !sess.data?.discordUserId) {
      return res.status(401).json({ ok: false, error: "Not connected to Discord." });
    }
    const discordUserId = String(sess.data.discordUserId);

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const playerId = String(body.playerId || "guest").trim().slice(0, 64) || "guest";
    const amount = Math.floor(Number(body.amount || 0));

    // ✅ REQUIRED for idempotency
    const idempotencyKey = String(body.idempotencyKey || "").trim();

    if (!idempotencyKey) {
      return res.status(400).json({ ok: false, error: "Missing idempotencyKey" });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    // ✅ Idempotency guard (NX)
    const ok = await redis.set(idemKey(discordUserId, idempotencyKey), "1", {
      nx: true,
      ex: 60, // 60s window prevents double-click / retries
    });

    if (!ok) {
      return res.status(409).json({
        ok: false,
        error: "Duplicate request blocked (idempotency). If you clicked twice, only the first one will apply.",
      });
    }

    // 1) Deduct from DRIP
    const deductUrl =
      `https://api.drip.re/api/v1/realms/${realmId}/credentials/balance` +
      `?type=discord-id&value=${encodeURIComponent(discordUserId)}`;

    const dr = await fetch(deductUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: -amount, // ✅ deduct
        ...(realmPointId ? { realmPointId } : {}),
        initiatorId: discordUserId,
      }),
    });

    const dj: any = await dr.json().catch(() => null);

    if (!dr.ok) {
      // release idempotency so user can retry if DRIP rejected
      await redis.del(idemKey(discordUserId, idempotencyKey));

      return res.status(500).json({
        ok: false,
        error: dj?.message || dj?.error || `DRIP deduct failed (${dr.status})`,
        details: dj || null,
      });
    }

    const dripBalance = Number(dj?.balance || 0);

    // 2) Credit into the game (Redis)
    const newBalance = await redis.incrby(balKey(playerId), amount);

    // ✅ Keep balance leaderboard accurate
    await redis.zadd(lbBalanceKey(), { score: Number(newBalance || 0), member: playerId });

    return res.status(200).json({
      ok: true,
      creditedTo: playerId,
      migrated: amount,
      dripBalance,
      gameBalance: Number(newBalance || 0),
    });
  } catch (err: any) {
    console.error("drip migrate error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
