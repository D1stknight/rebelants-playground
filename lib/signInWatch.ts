// lib/signInWatch.ts
// The points, Faction Wars and old shop routes answer { signIn: "discord" | "name" | "wallet" } when the
// player they were asked about has no signed session on this device (lib/server/player-auth.ts). One
// watcher over fetch turns every such answer into a "ra:sign-in-needed" event, so the sign-in banner
// (components/SignInAgain.tsx) shows wherever a game asked from. active = the player tried to do
// something (a 401), not just a balance read.
export type SignInKind = "discord" | "name" | "wallet";
export const SIGN_IN_EVENT = "ra:sign-in-needed";

const WATCHED = /^\/api\/(points|faction-wars|shop\/claim)(\/|$)/;

export function watchSignInAnswers() {
  if (typeof window === "undefined" || (window as any).__raSignInWatch) return;
  (window as any).__raSignInWatch = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    try {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, window.location.href);
      if (url.origin === window.location.origin && WATCHED.test(url.pathname) &&
        (res.headers.get("content-type") || "").includes("json")) {
        const active = res.status === 401;
        res.clone().json().then((j: any) => {
          const kind = j && j.signIn;
          if (kind === "discord" || kind === "name" || kind === "wallet") {
            window.dispatchEvent(new CustomEvent(SIGN_IN_EVENT, { detail: { kind, active } }));
          }
        }).catch(() => {});
      }
    } catch {
      // never in the game's way
    }
    return res;
  };
}
