// pages/api/shop/open.ts
// GET /api/shop/open?return=<a path here> -> the Rebel Economy's points shop (packs by card, APE or ETH):
// the same shop as After Dark and Rebel Universe. A player we know for sure (a verified Commander name
// session, or the economy's own session cookie) lands on it signed in (a 2-minute sign-in ticket from the
// economy); anyone else signs in there (Discord or name + PIN). Either way the shop's Back link returns
// to the page they came from.
import type { NextApiRequest, NextApiResponse } from "next";
import { ECONOMY_SHOP_URL, economyShopTicket, getSessionToken, getVerifiedNameUser, resolveBySessionToken } from "../../../lib/economy";

// a path on this site only (never another host)
function safePath(raw: unknown): string {
  const v = String(raw || "");
  return /^\/(?![\/\\])[A-Za-z0-9\-._~%&=+,:@\/?#]{0,500}$/.test(v) ? v : "/";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "play.rebelants.io").split(",")[0].trim();
  const origin = (process.env.PLAYGROUND_PUBLIC_ORIGIN || `${proto}://${host}`).replace(/\/+$/, "");
  const back = origin + safePath(req.query.return);
  // verified identities only (the ra_discord_user cookie is not signed, so it never opens a signed-in shop)
  const tok = getSessionToken(req);
  const user = (await getVerifiedNameUser(req)) || (tok ? await resolveBySessionToken(tok) : null);
  if (user) {
    const url = await economyShopTicket(user.userId, back);
    if (url) {
      res.setHeader("Referrer-Policy", "no-referrer");
      return res.redirect(302, url);
    }
  }
  return res.redirect(302, ECONOMY_SHOP_URL + "?return=" + encodeURIComponent(back));
}
