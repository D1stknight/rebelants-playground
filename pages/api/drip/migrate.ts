// pages/api/drip/migrate.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

async function getDiscordSession(req: NextApiRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const url = `${baseUrl}/api/auth/discord/session`;

  const r = await fetch(url, {
    method: "GET",
    headers: {
      cookie: req.headers.cookie || "",
    },
    cache: "no-store",
  });

  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok || !j?.discordUserId) return null;
  return j as { ok: true; discordUserId: string; discordName?: string };
}

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

function extractBalance(credJson: any, realmPointId?: string) {
  const targetId = (realmPointId || "").trim() || null;

  const candidates: any[] = [];
  if (Array.isArray(credJson?.pointBalances)) candidates.push(...credJson.pointBalances);
  if (Array.isArray(credJson?.balances)) candidates.push(...credJson.balances);
  if (Array.isArray(credJson?.points)) candidates.push(...credJson.points);
  if (Array.isArray(credJson?.credential?.pointBalances)) candidates.push(...credJson.credential.pointBalances);

  if (targetId) {
    const hit = candidates.find(
      (x) => String(x?.realmPointId || x?.pointId || x?.currencyId || "").trim() === targetId
    );
    if (hit) return Number(hit?.balance ?? hit?.amount ?? hit?.points ?? 0) || 0;
  }

  if (candidates.length === 1) {
    const x = candidates[0];
    return Number(x?.balance ?? x?.amount ?? x?.points ?? 0) || 0;
  }

  if (typeof credJson?.balance === "number") return Number(credJson.balance) || 0;
  return 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // never cache
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const DRIP_API_KEY = process.env.DRIP_API_KEY || "";
    const DRIP_REALM_ID = process.env.DRIP_REALM_ID || "";
    const DRIP_REALM_POINT_ID = (process.env.DRIP_REALM_POINT_ID || "").trim();

    if (!DRIP_API_KEY || !DRIP_REALM_ID) {
      return res.status(500).json({ ok: false, error: "Missing DRIP_API_KEY or DRIP_REALM_ID" });
    }

    const session = await getDiscordSession(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: "Not logged in with Discord" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const playerId = String(body?.playerId || "").trim().slice(0, 64);
    const amount = Number(body?.amount || 0);

    if (!playerId) return res.status(400).json({ ok: false, error: "Missing playerId" });
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    const discordUserId = String(session.discordUserId).trim();

    // 1) Find credential (to read balance)
    const findParams = new URLSearchParams({ type: "discord-id", value: discordUserId });
    const fr = await fetch(
      `https://api.drip.re/api/v1/realms/${DRIP_REALM_ID}/credentials/find?${findParams}`,
      { headers: { Authorization: `Bearer ${DRIP_API_KEY}` }, cache: "no-store" }
    );

    if (fr.status === 404) {
      return res.status(400).json({ ok: false, error: "No DRIP credential found for this Discord user." });
    }

    const fj = await fr.json().catch(() => null);
    if (!fr.ok) {
      return res.status(500).json({ ok: false, error: fj?.error || `DRIP error ${fr.status}` });
    }

    const dripBal = extractBalance(fj, DRIP_REALM_POINT_ID || undefined);

    if (dripBal < amount) {
      return res.status(400).json({
        ok: false,
        error: `Not enough DRIP points. You have ${dripBal}, tried to migrate ${amount}.`,
        dripBalance: dripBal,
      });
    }

    // 2) Deduct from DRIP (negative amount)  [oai_citation:2‡Drip](https://docs.drip.re/developer/credentials)
    const patchParams = new URLSearchParams({ type: "discord-id", value: discordUserId });
    const patchBody: any = { amount: -amount };
    if (DRIP_REALM_POINT_ID) patchBody.realmPointId = DRIP_REALM_POINT_ID;

    const pr = await fetch(
      `https://api.drip.re/api/v1/realms/${DRIP_REALM_ID}/credentials/balance?${patchParams}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${DRIP_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patchBody),
      }
    );

    const pj = await pr.json().catch(() => null);
    if (!pr.ok) {
      return res.status(500).json({ ok: false, error: pj?.error || `DRIP deduct failed ${pr.status}` });
    }

    // 3) Credit inside our game (Redis)
    const newBal = await redis.incrby(balKey(playerId), amount);

    return res.status(200).json({
      ok: true,
      playerId,
      migrated: amount,
      newGameBalance: Number(newBal || 0),
      discordUserId,
      dripBefore: dripBal,
      dripResponse: pj, // debug
    });
  } catch (err: any) {
    console.error("drip migrate error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
