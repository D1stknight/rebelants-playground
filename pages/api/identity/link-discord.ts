import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

function todayKey(playerId: string) {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `ra:points:earned:${playerId}:${yyyy}-${mm}-${dd}`;
}

function getCookie(req: NextApiRequest, name: string) {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((s) => s.trim());
  const hit = parts.find((p) => p.startsWith(name + "="));
  return hit ? decodeURIComponent(hit.split("=").slice(1).join("=")) : "";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ server-verified Discord session
    const raw = getCookie(req, "ra_discord_user");
    if (!raw) return res.status(401).json({ ok: false, error: "Not logged into Discord" });

    let session: any = null;
    try { session = JSON.parse(raw); } catch {}
    const discordUserId = String(session?.discordUserId || "");
    const discordName = String(session?.discordName || "");
    if (!discordUserId) return res.status(401).json({ ok: false, error: "Invalid Discord session" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const fromId = String(body.fromId || "").trim(); // current primaryId (wallet:... or guest-...)
    if (!fromId) return res.status(400).json({ ok: false, error: "Missing fromId" });

    const toId = `discord:${discordUserId}`;
    const migKey = `ra:identity:migrated:${fromId}->${toId}`;

    const already = await redis.get(migKey);
    if (already) {
      return res.status(200).json({ ok: true, alreadyLinked: true, playerId: toId, discordUserId, discordName });
    }

    // migrate balance
    const fromBal = Number((await redis.get<number>(balKey(fromId))) || 0);
    if (fromBal > 0) {
      await redis.incrby(balKey(toId), fromBal);
      await redis.set(balKey(fromId), 0);
    }

    // migrate today's earned (cap tracking)
    const fromEarn = Number((await redis.get<number>(todayKey(fromId))) || 0);
    if (fromEarn > 0) {
      await redis.incrby(todayKey(toId), fromEarn);
      await redis.set(todayKey(fromId), 0);
    }

    // mark migration complete (prevents duplicate)
    await redis.set(migKey, "1");

    // store mapping (useful later)
    await redis.set(`ra:identity:discord:${discordUserId}`, toId);

    return res.status(200).json({
      ok: true,
      alreadyLinked: false,
      playerId: toId,
      discordUserId,
      discordName,
      migrated: { balance: fromBal, earnedToday: fromEarn },
    });
  } catch (e: any) {
    console.error("link-discord error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
