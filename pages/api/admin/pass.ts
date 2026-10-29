// POST /api/admin/pass  { ticket }  — server to server, called by the Rebel Console (economy).
// The console's one-time ticket (scope "playground.console", owners/admins) is checked with the economy;
// if it is real, the console gets an 8-hour admin pass (lib/admin-pass.ts) to call the admin routes with
// (x-admin-token). middleware.ts swaps the pass for the real key, so ADMIN_KEY never leaves this server.
import type { NextApiRequest, NextApiResponse } from "next";
import { makePass } from "../../../lib/admin-pass";

const ECONOMY = (process.env.ECONOMY_BASE_URL || "https://economy.rebelants.io").replace(/\/+$/, "");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, error: "method_not_allowed" }); }
  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : req.body ?? {};
  const ticket = String(body.ticket || "");
  const secret = process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || "";
  const key = process.env.SERVICE_API_KEY || "";
  if (!secret || !key) return res.status(503).json({ ok: false, error: "not_connected" });
  if (!/^rat_[A-Za-z0-9_-]{20,96}$/.test(ticket)) return res.status(400).json({ ok: false, error: "bad_ticket" });
  let adminId = "";
  try {
    const r = await fetch(ECONOMY + "/api/internal/admin-ticket", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, scope: "playground.console" }),
      signal: AbortSignal.timeout(5000),
    });
    const j: any = await r.json().catch(() => null);
    if (r.ok && j?.ok === true && (j.role === "owner" || j.role === "admin")) adminId = String(j.adminId || "admin");
  } catch { adminId = ""; }
  if (!adminId) return res.status(401).json({ ok: false, error: "unauthorized" });
  return res.status(200).json({ ok: true, pass: await makePass(secret, adminId) });
}
