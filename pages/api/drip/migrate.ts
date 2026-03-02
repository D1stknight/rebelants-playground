// pages/api/drip/migrate.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

function lbBalanceKey() {
  return `ra:lb:balance`;
}

async function getDiscordSession(req: NextApiRequest) {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = req.headers.host;
  const url = `${proto}://${host}/api/auth/discord/session`;

  const r = await fetch(url, {
    method: "GET",
    headers: {
      cookie: req.headers.cookie || "",
      "cache-control": "no-store",
    },
  });
  const j: any = await r.json().catch(() => null);
  return { ok: r.ok && j?.ok, session: j };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const amount = Math.floor(Number(body.amount || 0));
    const playerId = String(body.playerId || "guest").trim().slice(0, 64) || "guest";

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    const { ok, session } = await getDiscordSession(req);
    if (!ok || !session?.discordUserId) {
      return res.status(401).json({ ok: false, error: "Discord not connected." });
    }

    const DRIP_API_KEY = mustEnv("DRIP_API_KEY");
    const DRIP_REALM_ID = mustEnv("DRIP_REALM_ID");
    const DRIP_REALM_POINT_ID = process.env.DRIP_REALM_POINT_ID || ""; // if you have multiple currencies, set this.

    const discordId = String(session.discordUserId);

    // 1) Find member by discord-id
    const searchUrl = `https://api.drip.re/api/v1/realm/${DRIP_REALM_ID}/members/search?type=discord-id&values=${encodeURIComponent(
      discordId
    )}`;

    const sr = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${DRIP_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const sj: any = await sr.json().catch(() => null);
    if (!sr.ok) {
      return res.status(sr.status).json({
        ok: false,
        error: sj?.error || sj?.message || "DRIP member search failed",
        detail: sj,
      });
    }

    const member = Array.isArray(sj) ? sj[0] : sj?.members?.[0] || sj?.[0];
    if (!member?.id) {
      return res.status(404).json({ ok: false, error: "DRIP member not found for this Discord ID." });
    }

    const memberId = String(member.id);

    // 2) Deduct points in DRIP (negative tokens)
    const deductUrl = `https://api.drip.re/api/v1/realm/${DRIP_REALM_ID}/members/${memberId}/point-balance`;

    const deductBody: any = { tokens: -amount };
    if (DRIP_REALM_POINT_ID) deductBody.realmPointId = DRIP_REALM_POINT_ID;

    const dr = await fetch(deductUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${DRIP_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(deductBody),
    });

    const dj: any = await dr.json().catch(() => null);
    if (!dr.ok) {
      return res.status(dr.status).json({
        ok: false,
        error: dj?.error || dj?.message || "DRIP deduction failed",
        detail: dj,
      });
    }

    // 3) Credit game balance
    const newBalance = await redis.incrby(balKey(playerId), amount);

    // 4) Keep “Balance leaderboard” accurate
    await redis.zadd(lbBalanceKey(), { score: Number(newBalance || 0), member: playerId });

    return res.status(200).json({
      ok: true,
      discordUserId: discordId,
      memberId,
      playerId,
      migrated: amount,
      balance: Number(newBalance || 0),
    });
  } catch (err: any) {
    console.error("drip migrate error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
