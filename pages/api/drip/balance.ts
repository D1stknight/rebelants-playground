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
    const realmPointId = (process.env.DRIP_REALM_POINT_ID || "").trim(); // optional

    const discordId = String(session.discordUserId);

    // ✅ DRIP: Find credential by discord-id
    const findUrl =
      `https://api.drip.re/api/v1/realms/${realmId}/credentials/find` +
      `?type=discord-id&value=${encodeURIComponent(discordId)}`;

    const fr = await fetch(findUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    const fj: any = await fr.json().catch(() => null);

    if (!fr.ok) {
      // ✅ If user has no DRIP credential yet, treat as zero balance (do NOT error)
      const msg = String(fj?.detail?.message || fj?.message || fj?.error || "").toLowerCase();

      if (fr.status === 404 || msg.includes("credential not found")) {
        return res.status(200).json({
          ok: true,
          discordUserId: discordId,
          balance: 0,
          debug: {
            realmPointId: realmPointId || null,
            balancesCount: 0,
            note: "No DRIP credential linked",
          },
        });
      }

      return res.status(fr.status).json({
        ok: false,
        error: fj?.error || "DRIP credential lookup failed",
        detail: fj,
      });
    }

    // ✅ DRIP responses often look like: { data: { balances: [...] } }
    const balances: any[] =
      (Array.isArray(fj?.data?.balances) && fj.data.balances) ||
      (Array.isArray(fj?.balances) && fj.balances) ||
      [];

    let balance = 0;

const readBal = (b: any) =>
  Number(
    b?.balance ??
      b?.amount ??
      b?.value ??
      b?.points ??
      b?.available ??
      0
  ) || 0;

if (realmPointId) {
  const hit = balances.find((b: any) => {
    const ids = [
      b?.realmPointId,
      b?.pointId,
      b?.id,
      b?.realmPoint?.id,
      b?.point?.id,
    ]
      .map((x: any) => String(x || "").trim())
      .filter(Boolean);

    return ids.includes(String(realmPointId).trim());
  });

  // ✅ If match found, use it. Otherwise fallback to first balance returned.
  if (hit) balance = readBal(hit);
  else if (balances.length) balance = readBal(balances[0]);
} else {
  if (balances.length) balance = readBal(balances[0]);
}

    return res.status(200).json({
      ok: true,
      discordUserId: discordId,
      balance,
      debug: {
        realmPointId: realmPointId || null,
        balancesCount: balances.length,
      },
    });
  } catch (e: any) {
    console.error("drip balance error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
