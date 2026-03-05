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
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const { ok, session } = await getDiscordSession(req);
    if (!ok || !session?.discordUserId) {
      return res.status(401).json({ ok: false, error: "Discord not connected." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const amt = Math.floor(Number(body.amount || 0));
    const playerId = String(body.playerId || "").trim().slice(0, 64);

    if (!playerId) return res.status(400).json({ ok: false, error: "Missing playerId" });
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ ok: false, error: "Invalid amount" });

    const realmId = mustEnv("DRIP_REALM_ID");
    const apiKey = mustEnv("DRIP_API_KEY");
    const realmPointId = process.env.DRIP_REALM_POINT_ID || ""; // recommended

    const discordId = String(session.discordUserId);

    // ✅ DRIP: Deduct points from this discord credential
    // Docs: PATCH /api/v1/realms/{realmId}/credentials/balance?type=discord-id&value=...  [oai_citation:4‡docs.drip.re](https://docs.drip.re/api-reference/credentials-balances/update-point-balance-for-a-credential-by-its-identifier-email-wallet-discord-id-etc)
    const patchUrl =
      `https://api.drip.re/api/v1/realms/${realmId}/credentials/balance` +
      `?type=discord-id&value=${encodeURIComponent(discordId)}`;

    const pr = await fetch(patchUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: -amt, // ✅ negative = deduct
        ...(realmPointId ? { realmPointId } : {}),
        initiatorId: `rebelants-playground`,
      }),
    });

    const pj: any = await pr.json().catch(() => null);

       if (!pr.ok) {
      const msg = String(pj?.detail?.message || pj?.message || pj?.error || "").toLowerCase();

      // ✅ If the user has no DRIP credential yet, return a friendly 400 (no retries)
      if (pr.status === 404 || msg.includes("credential not found")) {
        return res.status(400).json({
          ok: false,
          error: "DRIP credential not found for this Discord account. User must link DRIP first.",
          detail: pj,
        });
      }

      return res.status(pr.status).json({
        ok: false,
        error: pj?.error || "DRIP deduction failed",
        detail: pj,
      });
    }

    // ✅ Credit game balance
    const newBal = await redis.incrby(balKey(playerId), amt);

    // ✅ Keep “balance leaderboard” accurate (visibility list)
    await redis.zadd(lbBalanceKey(), { score: Number(newBal || 0), member: playerId });

    return res.status(200).json({
      ok: true,
      discordUserId: discordId,
      playerId,
      migrated: amt,
      balance: Number(newBal || 0),
      drip: {
        credentialId: pj?.credentialId,
        identifier: pj?.identifier,
        balance: pj?.balance,
        realmPointId: pj?.realmPointId,
        linked: pj?.linked,
      },
    });
  } catch (e: any) {
    console.error("drip migrate error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
