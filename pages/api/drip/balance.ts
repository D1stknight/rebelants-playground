// pages/api/drip/balance.ts
import type { NextApiRequest, NextApiResponse } from "next";

const DRIP_API = "https://api.drip.re/api/v1";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// We assume your Discord session endpoint returns { ok:true, discordUserId:string }
async function getDiscordUserId(req: NextApiRequest) {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = req.headers.host;
  const url = `${proto}://${host}/api/auth/discord/session`;

  const r = await fetch(url, { method: "GET", headers: { "Cache-Control": "no-store" } });
  const j: any = await r.json().catch(() => null);

  if (!r.ok || !j?.ok || !j?.discordUserId) return null;
  return String(j.discordUserId);
}

// Tries multiple credential types to be safe.
// (Drip docs show twitter-id, wallet, email, etc.)  [oai_citation:1‡docs.drip.re](https://docs.drip.re/developer/credentials)
const CRED_TYPES_TO_TRY = ["discord-id", "discord", "social:discord", "email"];

async function findCredential(realmId: string, apiKey: string, type: string, value: string) {
  const params = new URLSearchParams({ type, value });
  const url = `${DRIP_API}/realms/${realmId}/credentials/find?${params.toString()}`;

  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (r.status === 404) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || j?.message || `DRIP find failed (${r.status})`);
  return j;
}

function extractBalance(cred: any) {
  // Drip credential objects often include balances or pointBalances; keep this defensive.
  const realmPointId = process.env.DRIP_REALM_POINT_ID || null;

  const candidates = [
    cred?.balance,
    cred?.points,
    cred?.pointBalance,
    cred?.balances?.[realmPointId || ""],
    cred?.balances?.default,
  ];

  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }

  // common pattern: balances array objects
  const arr = cred?.balances || cred?.pointBalances;
  if (Array.isArray(arr)) {
    if (realmPointId) {
      const hit = arr.find((x: any) => String(x?.realmPointId) === String(realmPointId));
      const n = Number(hit?.balance ?? hit?.amount ?? hit?.points);
      if (Number.isFinite(n)) return n;
    }
    const first = arr[0];
    const n = Number(first?.balance ?? first?.amount ?? first?.points);
    if (Number.isFinite(n)) return n;
  }

  return 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const realmId = mustEnv("DRIP_REALM_ID");
    const apiKey = mustEnv("DRIP_API_KEY");

    const discordUserId = await getDiscordUserId(req);
    if (!discordUserId) {
      return res.status(401).json({ ok: false, error: "Discord not connected." });
    }

    // Try to find their credential
    let cred: any = null;
    let usedType: string | null = null;

    for (const t of CRED_TYPES_TO_TRY) {
      try {
        const c = await findCredential(realmId, apiKey, t, discordUserId);
        if (c) {
          cred = c;
          usedType = t;
          break;
        }
      } catch {
        // ignore and keep trying types
      }
    }

    if (!cred) {
      return res.status(404).json({
        ok: false,
        error: "No DRIP credential found for this Discord user yet.",
      });
    }

    const balance = extractBalance(cred);

    return res.status(200).json({
      ok: true,
      discordUserId,
      credentialType: usedType,
      balance: Number(balance || 0),
    });
  } catch (err: any) {
    console.error("drip/balance error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
