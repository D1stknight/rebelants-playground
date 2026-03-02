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

  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const { ok, session } = await getDiscordSession(req);
    if (!ok || !session?.discordUserId) {
      return res.status(401).json({ ok: false, error: "Discord not connected." });
    }

    const DRIP_API_KEY = mustEnv("DRIP_API_KEY");
    const DRIP_REALM_ID = mustEnv("DRIP_REALM_ID");
    const DRIP_REALM_POINT_ID = process.env.DRIP_REALM_POINT_ID || ""; // optional but recommended

    const discordId = String(session.discordUserId);

    const url = `https://api.drip.re/api/v1/realm/${DRIP_REALM_ID}/members/search?type=discord-id&values=${encodeURIComponent(
      discordId
    )}`;

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${DRIP_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const j: any = await r.json().catch(() => null);
    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: j?.error || j?.message || "DRIP member search failed",
        detail: j,
      });
    }

    const member = Array.isArray(j) ? j[0] : j?.members?.[0] || j?.[0];
    if (!member) {
      return res.status(404).json({ ok: false, error: "DRIP member not found for this Discord ID." });
    }

    const balances = member.pointBalances || member.point_balances || [];
    let bal = 0;

    if (DRIP_REALM_POINT_ID) {
      const row = balances.find((b: any) => String(b?.realmPointId || b?.realm_point_id) === DRIP_REALM_POINT_ID);
      bal = Number(row?.balance || 0);
    } else {
      // fallback: first currency balance
      bal = Number(balances?.[0]?.balance || 0);
    }

    return res.status(200).json({
      ok: true,
      discordUserId: discordId,
      memberId: member.id || member.memberId,
      balance: Number.isFinite(bal) ? bal : 0,
    });
  } catch (err: any) {
    console.error("drip balance error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
