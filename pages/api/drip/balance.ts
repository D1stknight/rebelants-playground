// pages/api/drip/balance.ts
import type { NextApiRequest, NextApiResponse } from "next";

const DRIP_API_KEY = process.env.DRIP_API_KEY || "";
const DRIP_REALM_ID = process.env.DRIP_REALM_ID || "";
const DRIP_REALM_POINT_ID = process.env.DRIP_REALM_POINT_ID || ""; // optional

function absUrl(req: NextApiRequest, path: string) {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = req.headers.host;
  return `${proto}://${host}${path}`;
}

async function getDiscordSession(req: NextApiRequest) {
  // IMPORTANT: forward cookies so the session endpoint can read the user session
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

// Find ghost credential by type/value
async function findDiscordCredential(discordUserId: string) {
  const params = new URLSearchParams({ type: "discord-id", value: discordUserId });
  const r = await dripFetch(`/api/v1/realms/${DRIP_REALM_ID}/credentials/find?${params}`);
  if (r.status === 404) return null;
  const j: any = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `DRIP find failed (${r.status})`);
  return j;
}

// Create ghost credential for Discord (if missing)
async function createDiscordCredential(discordUserId: string, discordName: string) {
  const r = await dripFetch(`/api/v1/realms/${DRIP_REALM_ID}/credentials/social`, {
    method: "POST",
    body: JSON.stringify({
      provider: "discord",
      providerId: discordUserId,
      username: discordName || `discord:${discordUserId}`,
    }),
  });

  // If it already exists, DRIP may return 409 — just find it after.
  if (r.status === 409) return null;

  const j: any = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `DRIP create failed (${r.status})`);
  return j;
}

function extractBalance(cred: any) {
  // DRIP responses can vary; common patterns:
  // - cred.balances = [{ amount, realmPointId, ... }]
  // - cred.balance / cred.amount
  const balances = Array.isArray(cred?.balances) ? cred.balances : [];
  if (balances.length) {
    // If you have multiple currencies, prefer DRIP_REALM_POINT_ID if set
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // never cache
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    if (!DRIP_API_KEY || !DRIP_REALM_ID) {
      return res.status(500).json({ ok: false, error: "Missing DRIP env vars (DRIP_API_KEY / DRIP_REALM_ID)" });
    }

    const sess = await getDiscordSession(req);
    if (!sess) {
      return res.status(401).json({ ok: false, error: "Discord not connected." });
    }

    // Find or create the ghost credential
    let cred = await findDiscordCredential(sess.discordUserId);

    if (!cred) {
      await createDiscordCredential(sess.discordUserId, sess.discordName);
      cred = await findDiscordCredential(sess.discordUserId);
    }

    if (!cred) {
      return res.status(500).json({ ok: false, error: "Could not create/find DRIP credential for this Discord user." });
    }

    const balance = extractBalance(cred);

    return res.status(200).json({
      ok: true,
      discordUserId: sess.discordUserId,
      balance,
    });
  } catch (err: any) {
    console.error("drip/balance error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
