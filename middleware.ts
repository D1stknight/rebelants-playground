// Lets the Rebel Console's admin pass (lib/admin-pass.ts) open the Playground admin: on /api/*,
// a valid pass in x-admin-key / x-admin-token is swapped for the real ADMIN_KEY before the route
// sees it; an invalid or expired pass is removed (so the route answers 401). Anything else
// (including the old typed key) passes through untouched.
import { NextResponse, type NextRequest } from "next/server";
import { checkPass, PASS_PREFIX } from "./lib/admin-pass";

export async function middleware(req: NextRequest) {
  const a = req.headers.get("x-admin-key") || "";
  const b = req.headers.get("x-admin-token") || "";
  if (!a.startsWith(PASS_PREFIX) && !b.startsWith(PASS_PREFIX)) return NextResponse.next();
  const secret = process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || "";
  const pass = a.startsWith(PASS_PREFIX) ? a : b;
  const headers = new Headers(req.headers);
  headers.delete("x-admin-key");
  headers.delete("x-admin-token");
  if (secret && (await checkPass(secret, pass))) {
    headers.set("x-admin-key", secret);
    headers.set("x-admin-token", secret);
  }
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/api/:path*"] };
