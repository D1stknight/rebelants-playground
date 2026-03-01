// pages/api/drip/balance.ts
import type { NextApiRequest, NextApiResponse } from "next";

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
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

    // Find credential + balances
    const url =
      `https://api.drip.re/api/v1/realms/${realmId}/credentials/find` +
      `?type=discord-id&value=${encodeURIComponent(discordUserId)}`;

    const r = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const j: any = await r.json().catch(() => null);

    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        error: j?.message || j?.error || `DRIP find credential failed (${r.status})`,
        details: j || null,
      });
    }

    // DRIP returns balances array; pick the right currency
    const balances: any[] = Array.isArray(j?.balances) ? j.balances : [];
    const picked =
      realmPointId
        ? balances.find((b) => String(b?.realmPointId) === String(realmPointId))
        : balances[0];

    const balance = Number(picked?.balance || 0);

    return res.status(200).json({
      ok: true,
      discordUserId,
      balance,
      realmPointId: picked?.realmPointId || realmPointId || null,
    });
  } catch (err: any) {
    console.error("drip balance error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
