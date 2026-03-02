// pages/api/drip/migrate.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

const DRIP_API_KEY = process.env.DRIP_API_KEY || "";
const DRIP_REALM_ID = process.env.DRIP_REALM_ID || "";
const DRIP_REALM_POINT_ID = process.env.DRIP_REALM_POINT_ID || ""; // optional

function absUrl(req: NextApiRequest, path: string) {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = req.headers.host;
  return `${proto}://${host}${path}`;
}

async function getDiscordSession(req: NextApiRequest) {
  const r = await fetch(absUrl(req, "/api/auth/discord/session"), {
    method: "GET",
    headers: {
      Cookie: req.headers.cookie || "",
      "Cache-Control": "no-store",
    },
  });

  const j: any = await r.json().catch(() => null);
  if (!r.ok || !j?.ok || !j?.discordUserId) return null;
  return {
    discordUserId: String(j.discordUserId),
    discordName: String(j.discordName || ""),
  };
}

async function dripFetch(path: string, init?: RequestInit) {
  if (!DRIP_API_KEY) throw new Error("Missing DRIP_API_KEY");
  const r = await fetch(`https://api.drip.re${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${DRIP_API_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  return r;
}

async function findDiscordCredential(discordUserId: string) {
  const params = new URLSearchParams({ type: "discord-id", value: discordUserId });
  const r = await dripFetch(`/api/v1/realms/${DRIP_REALM_ID}/credentials/find?${params}`);
  if (r.status === 404) return null;
  const j: any = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `DRIP find failed (${r.status})`);
  return j;
}

async function createDiscordCredential(discordUserId: string, discordName: string) {
  const r = await dripFetch(`/api/v1/realms/${DRIP_REALM_ID}/credentials/social`, {
    method: "POST",
    body: JSON.stringify({
      provider: "discord",
      providerId: discordUserId,
      username: discordName || `discord:${discordUserId}`,
    }),
  });

  if (r.status === 409) return null;

  const j: any = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `DRIP create failed (${r.status})`);
  return j;
}

function extractBalance(cred: any) {
  const balances = Array.isArray(cred?.balances) ? cred.balances : [];
  if (balances.length) {
    if (DRIP_REALM_POINT_ID) {
      const hit = balances.find((b: any) => String(b?.realmPointId || "") === DRIP_REALM_POINT_ID);
      if (hit && Number.isFinite(Number(hit?.amount))) return Number(hit.amount);
    }
    const first = balances[0];
    if (Number.isFinite(Number(first?.amount))) return Number(first.amount);
  }

  if (Number.isFinite(Number(cred?.balance))) return Number(cred.balance);
  if (Number.isFinite(Number(cred?.amount))) return Number(cred.amount);
  return 0;
}

async function deductFromDrip(discordUserId: string, amount: number) {
  // PATCH /credentials/balance?type=discord-id&value=... { amount: -X, realmPointId? }
  const params = new URLSearchParams({ type: "discord-id", value: discordUserId });

  const body: any = { amount: -Math.abs(amount) };
  if (DRIP_REALM_POINT_ID) body.realmPointId = DRIP_REALM_POINT_ID;

  const r = await dripFetch(`/api/v1/realms/${DRIP_REALM_ID}/credentials/balance?${params}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

  const j: any = await r.json().catch(() => null);
  if (!r.ok) {
    // DRIP commonly uses 400 INSUFFICIENT_BALANCE for overdraft attempts
    throw new Error(j?.error || j?.message || `DRIP deduct failed (${r.status})`);
  }
  return j;
}

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}
function lbBalanceKey() {
  return `ra:lb:balance`;
}

// Idempotency key storage
function idemKey(discordUserId: string, idem: string) {
  return `ra:drip:migrate:idem:${discordUserId}:${idem}`.slice(0, 220);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    if (!DRIP_API_KEY || !DRIP_REALM_ID) {
      return res.status(500).json({ ok: false, error: "Missing DRIP env vars (DRIP_API_KEY / DRIP_REALM_ID)" });
    }

    const sess = await getDiscordSession(req);
    if (!sess) {
      return res.status(401).json({ ok: false, error: "Discord not connected." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const amount = Math.floor(Number(body.amount || 0));
    const playerId = String(body.playerId || "").trim().slice(0, 64);

    if (!playerId) return res.status(400).json({ ok: false, error: "Missing playerId" });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: "Invalid amount" });

    // ✅ Idempotency guard (prevents double-click double-charge)
    const idem = String(req.headers["x-idempotency-key"] || body.idempotencyKey || "").trim();
    if (!idem) {
      return res.status(400).json({ ok: false, error: "Missing idempotency key" });
    }

    const ik = idemKey(sess.discordUserId, idem);
    const already = await redis.get<any>(ik);
    if (already) {
      // return the same result again
      return res.status(200).json(already);
    }

    // Create/find ghost credential first
    let cred = await findDiscordCredential(sess.discordUserId);
    if (!cred) {
      await createDiscordCredential(sess.discordUserId, sess.discordName);
      cred = await findDiscordCredential(sess.discordUserId);
    }
    if (!cred) {
      return res.status(500).json({ ok: false, error: "Could not create/find DRIP credential for this Discord user." });
    }

    const dripBalBefore = extractBalance(cred);
    if (dripBalBefore < amount) {
      const out = {
        ok: false,
        error: "Insufficient DRIP balance",
        dripBalance: dripBalBefore,
      };
      await redis.set(ik, out, { ex: 60 * 10 });
      return res.status(400).json(out);
    }

    // 1) Deduct from DRIP first (no double-dipping)
    await deductFromDrip(sess.discordUserId, amount);

    // 2) Credit the game balance (Redis)
    const newBalance = await redis.incrby(balKey(playerId), amount);

    // ✅ update balance leaderboard (same behavior as admin grant)
    await redis.zadd(lbBalanceKey(), { score: Number(newBalance || 0), member: playerId });

    // 3) Re-read DRIP balance (best-effort)
    const credAfter = await findDiscordCredential(sess.discordUserId);
    const dripBalAfter = credAfter ? extractBalance(credAfter) : null;

    const out = {
      ok: true,
      playerId,
      discordUserId: sess.discordUserId,
      migrated: amount,
      balance: Number(newBalance || 0),
      dripBalance: typeof dripBalAfter === "number" ? dripBalAfter : undefined,
    };

    // store idempotent result for 10 minutes
    await redis.set(ik, out, { ex: 60 * 10 });

    return res.status(200).json(out);
  } catch (err: any) {
    console.error("drip/migrate error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
