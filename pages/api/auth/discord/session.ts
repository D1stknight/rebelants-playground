import type { NextApiRequest, NextApiResponse } from "next";

function getCookie(req: NextApiRequest, name: string) {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((s) => s.trim());
  const hit = parts.find((p) => p.startsWith(name + "="));
  return hit ? decodeURIComponent(hit.split("=").slice(1).join("=")) : "";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const raw = getCookie(req, "ra_discord_user");
  if (!raw) return res.status(200).json({ ok: false });

  try {
    const j = JSON.parse(raw);
    if (!j?.discordUserId) return res.status(200).json({ ok: false });
    return res.status(200).json({ ok: true, discordUserId: j.discordUserId, discordName: j.discordName });
  } catch {
    return res.status(200).json({ ok: false });
  }
}
