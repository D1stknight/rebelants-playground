// pages/api/drip/balance.ts
import type { NextApiRequest, NextApiResponse } from "next";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
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
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const { ok, session } = await getDiscordSession(req);
    if (!ok || !session?.discordUserId) {
      return res.status(401).json({ ok: false, error: "Discord not connected." });
    }

    const realmId = mustEnv("DRIP_REALM_ID");
    const apiKey = mustEnv("DRIP_API_KEY");
    const realmPointId = (process.env.DRIP_REALM_POINT_ID || "").trim(); // recommended
    const discordId = String(session.discordUserId);

    // ✅ Get DRIP balance directly
    const url =
      `https://api.drip.re/api/v1/realms/${realmId}/credentials/balance` +
      `?type=discord-id&value=${encodeURIComponent(discordId)}` +
      (realmPointId ? `&realmPointId=${encodeURIComponent(realmPointId)}` : "");

    const r = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    const j: any = await r.json().catch(() => null);

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: j?.error || "DRIP balance lookup failed",
        detail: j,
      });
    }

    const balance = Number(j?.balance ?? j?.amount ?? 0) || 0;

    return res.status(200).json({
      ok: true,
      discordUserId: discordId,
      balance,
      realmPointId: realmPointId || undefined,
    });
  } catch (e: any) {
    console.error("drip balance error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
