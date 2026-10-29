// POST /api/admin/sso  (form field: ticket) — opened by the Rebel Console (economy.rebelants.io/admin).
// The ticket is checked with the economy (SERVICE_API_KEY, scope "playground.admin"); if it is
// real, the browser gets an 8-hour admin pass in this tab and lands on /admin, already signed in.
import type { NextApiRequest, NextApiResponse } from "next";
import { makePass } from "../../../lib/admin-pass";

const ECONOMY = (process.env.ECONOMY_BASE_URL || "https://economy.rebelants.io").replace(/\/+$/, "");

function page(res: NextApiResponse, status: number, body: string) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.status(status).send("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Playground admin</title><body style='background:#15120e;color:#f3ead6;font:16px system-ui;padding:24px'>" + body);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return page(res, 405, "Open the Playground admin from the Rebel Console."); }
  const ticket = String((req.body && (req.body as any).ticket) || "");
  const secret = process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || "";
  const key = process.env.SERVICE_API_KEY || "";
  if (!secret || !key) return page(res, 503, "The Playground is not connected to the console yet.");
  if (!/^rat_[A-Za-z0-9_-]{20,96}$/.test(ticket)) return page(res, 400, "That link did not work. Open the Playground from the Rebel Console again.");
  let ok = false, adminId = "admin";
  try {
    const r = await fetch(ECONOMY + "/api/internal/admin-ticket", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, scope: "playground.admin" }),
      signal: AbortSignal.timeout(5000),
    });
    const j: any = await r.json().catch(() => null);
    ok = r.ok && j?.ok === true && (j.role === "owner" || j.role === "admin");
    if (ok && typeof j.adminId === "string") adminId = j.adminId;
  } catch { ok = false; }
  if (!ok) return page(res, 401, "That link did not work (it works once, for 2 minutes). Open the Playground from the Rebel Console again.");
  const pass = await makePass(secret, adminId);
  // the pass only ever lives in this tab's sessionStorage, like the typed key did
  return page(res, 200, "Signing you in…<script>try{sessionStorage.setItem('ra_admin_token'," + JSON.stringify(pass) + ");sessionStorage.setItem('ra_admin_sso','1')}catch(e){}location.replace('/admin')</script>");
}
