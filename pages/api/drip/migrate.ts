// pages/api/drip/migrate.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

const DRIP_API = "https://api.drip.re/api/v1";

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
function idemKey(discordUserId: string, key: string) {
  return `ra:drip:migrate:idem:${discordUserId}:${key}`;
}

// same session getter as balance.ts
async function getDiscordSession(req: NextApiRequest) {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = req.headers.host;
  const url = `${proto}://${host}/api/auth/discord/session`;

  const r = await fetch(url, { method: "GET", headers: { "Cache-Control": "no-store" } });
  const j: any = await r.json().catch(() => null);
  if (!r.ok || !j?.ok || !j?.discordUserId) return null;
  return { discordUserId: String(j.discordUserId), discordName: String(j.discordName || "") };
}

const CRED_TYPES_TO_TRY = ["discord-id", "discord", "social:discord", "email"];

async function findCredential(realmId: string, apiKey: string, type: string, value: string) {
  const params = new URLSearchParams({ type, value });
  const url = `${DRIP_API}/realms/${realmId}/credentials/find?${params.toString()}`;

  const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (r.status === 404) return null;

  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || j?.message || `DRIP find failed (${r.status})`);
  return j;
}

// Drip docs: PATCH /credentials/balance?type&value with JSON body {amount, realmPointId?}  [oai_citation:2‡docs.drip.re](https://docs.drip.re/developer/credentials)
async function updateCredentialBalance(opts: {
  realmId: string;
  apiKey: string;
  type: string;
  value: string;
  amount: number;
  realmPointId?: string | null;
}) {
  const params = new URLSearchParams({ type: opts.type, value: opts.value });
  const url = `${DRIP_API}/realms/${opts.realmId}/credentials/balance?${params.toString()}`;

  const body: any = { amount: opts.amount };
  if (opts.realmPointId) body.realmPointId = opts.realmPointId;

  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const j = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(j?.error || j?.message || `DRIP balance update failed (${r.status})`);
  }
  return j;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const sess = await getDiscordSession(req);
    if (!sess?.discordUserId) {
      return res.status(401).json({ ok: false, error: "Discord not connected." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const playerId = String(body.playerId || "guest").trim().slice(0, 64) || "guest";
    const amount = Math.floor(Number(body.amount || 0));

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    // ✅ idempotency (prevents double click / retry double-charge)
    const idempotencyKey =
      String(req.headers["x-idempotency-key"] || body.idempotencyKey || "").trim() ||
      `${playerId}:${amount}:${new Date().toISOString().slice(0, 10)}`;

    const already = await redis.get<string>(idemKey(sess.discordUserId, idempotencyKey));
    if (already) {
      return res.status(200).json(JSON.parse(already));
    }

    const realmId = mustEnv("DRIP_REALM_ID");
    const apiKey = mustEnv("DRIP_API_KEY");
    const realmPointId = process.env.DRIP_REALM_POINT_ID || null;

    // Find credential type that exists for this discord user
    let usedType: string | null = null;
    for (const t of CRED_TYPES_TO_TRY) {
      const found = await findCredential(realmId, apiKey, t, sess.discordUserId);
      if (found) {
        usedType = t;
        break;
      }
    }

    if (!usedType) {
      return res.status(404).json({ ok: false, error: "No DRIP credential found for this Discord user yet." });
    }

    // 1) Deduct from DRIP
    await updateCredentialBalance({
      realmId,
      apiKey,
      type: usedType,
      value: sess.discordUserId,
      amount: -amount,
      realmPointId,
    });

    // 2) Credit game balance (Redis)
    const newBalance = await redis.incrby(balKey(playerId), amount);

    // 3) Keep balance leaderboard accurate (same as admin grant)
    await redis.zadd(lbBalanceKey(), { score: Number(newBalance || 0), member: playerId });

    const result = {
      ok: true,
      playerId,
      credited: amount,
      balance: Number(newBalance || 0),
      drip: {
        discordUserId: sess.discordUserId,
        credentialType: usedType,
        deducted: amount,
      },
    };

    // Store idempotency result for 10 minutes
    await redis.set(idemKey(sess.discordUserId, idempotencyKey), JSON.stringify(result), { ex: 600 });

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("drip/migrate error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
