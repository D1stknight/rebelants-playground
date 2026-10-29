// Console sign-in for the Playground admin (Oct 28, 2026).
// The Rebel Console trades a one-time admin ticket at /api/admin/pass (server to server); after the economy confirms it,
// the Playground gives the browser an "admin pass": pga1.<expires>.<adminId>.<signature>, good for
// 8 hours, signed with ADMIN_KEY (which never leaves the server this way). middleware.ts swaps a
// valid pass for the real key on /api/* requests, so every existing admin route keeps working
// unchanged. Typing the old key still works too, until it is retired.
export const PASS_PREFIX = "pga1.";
export const PASS_TTL_MS = 8 * 60 * 60 * 1000;

const enc = new TextEncoder();
function b64url(bytes: ArrayBuffer): string {
  let s = "";
  const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode("playground-admin-pass:" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function makePass(secret: string, adminId: string, now = Date.now()): Promise<string> {
  const exp = String(now + PASS_TTL_MS);
  const who = adminId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "admin";
  const body = exp + "." + who;
  return PASS_PREFIX + body + "." + (await sign(secret, body));
}

/** true when the pass is genuine and not expired. */
export async function checkPass(secret: string, pass: string, now = Date.now()): Promise<boolean> {
  if (!secret || !pass.startsWith(PASS_PREFIX) || pass.length > 200) return false;
  const parts = pass.slice(PASS_PREFIX.length).split(".");
  if (parts.length !== 3) return false;
  const [exp, who, sig] = parts;
  if (!/^\d{13}$/.test(exp) || Number(exp) < now || Number(exp) > now + PASS_TTL_MS + 60_000) return false;
  const want = await sign(secret, exp + "." + who);
  if (want.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
