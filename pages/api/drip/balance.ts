// pages/api/drip/balance.ts
import type { NextApiRequest, NextApiResponse } from "next";

function getCookie(req: NextApiRequest, name: string) {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((p) => p.trim());
  const hit = parts.find((p) => p.startsWith(name + "="));
  if (!hit) return "";
  return decodeURIComponent(hit.split("=").slice(1).join("="));
}

/**
 * We keep this compatible with however you stored the Discord session.
 * If your /api/auth/discord/session endpoint works, this endpoint uses it.
 */
async function getDiscordSession(req: NextApiRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const url = `${baseUrl}/api/auth/discord/session`;

  const r = await fetch(url, {
    method: "GET",
    headers: {
      // forward cookies so session is readable server-side
      cookie: req.headers.cookie || "",
    },
    cache: "no-store",
  });

  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok || !j?.discordUserId) return null;
  return j as { ok: true; discordUserId: string; discordName?: string };
}

function extractBalance(credJson: any, realmPointId?: string) {
  // DRIP returns credential JSON; balances are typically in an array of point balances.
  // We'll defensively scan common shapes.

  const targetId = (realmPointId || "").trim() || null;

  const candidates: any[] = [];

  // common
  if (Array.isArray(credJson?.pointBalances)) candidates.push(...credJson.pointBalances);
  if (Array.isArray(credJson?.balances)) candidates.push(...credJson.balances);
  if (Array.isArray(credJson?.points)) candidates.push(...credJson.points);

  // sometimes nested
  if (Array.isArray(credJson?.credential?.pointBalances)) candidates.push(...credJson.credential.pointBalances);

  // If there is a realmPointId, prefer it
  if (targetId) {
    const hit = candidates.find(
      (x) => String(x?.realmPointId || x?.pointId || x?.currencyId || "").trim() === targetId
    );
    if (hit) return Number(hit?.balance ?? hit?.amount ?? hit?.points ?? 0) || 0;
  }

  // Otherwise: if there is only one, use it
  if (candidates.length === 1) {
    const x = candidates[0];
    return Number(x?.balance ?? x?.amount ?? x?.points ?? 0) || 0;
  }

  // Otherwise: try any "default" looking balance field
  if (typeof credJson?.balance === "number") return Number(credJson.balance) || 0;

  return 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // never cache
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
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

    const discordUserId = String(session.discordUserId).trim();
    const params = new URLSearchParams({ type: "discord-id", value: discordUserId });

    const r = await fetch(`https://api.drip.re/api/v1/realms/${DRIP_REALM_ID}/credentials/find?${params}`, {
      headers: { Authorization: `Bearer ${DRIP_API_KEY}` },
      cache: "no-store",
    });

    if (r.status === 404) {
      // no credential yet => 0
      return res.status(200).json({
        ok: true,
        discordUserId,
        balance: 0,
        realmPointId: DRIP_REALM_POINT_ID || null,
        credentialExists: false,
      });
    }

    const j = await r.json().catch(() => null);
    if (!r.ok) {
      return res.status(500).json({ ok: false, error: j?.error || `DRIP error ${r.status}` });
    }

    const balance = extractBalance(j, DRIP_REALM_POINT_ID || undefined);

    return res.status(200).json({
      ok: true,
      discordUserId,
      discordName: session.discordName || null,
      balance,
      realmPointId: DRIP_REALM_POINT_ID || null,
      credentialExists: true,
      raw: j, // keep for debugging; remove later if you want
    });
  } catch (err: any) {
    console.error("drip balance error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
