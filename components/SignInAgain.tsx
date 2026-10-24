// components/SignInAgain.tsx
// Points only move for a player a signed session proves (lib/server/player-auth.ts). When a route answers
// that this device has no such session for the player in the profile, this card asks for the matching
// sign-in: Discord, the Commander name + PIN, or the wallet's signature. Mounted once in pages/_app.tsx.
import React, { useEffect, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";
import { getEffectivePlayerId, loadProfile, saveProfile } from "../lib/profile";
import { SIGN_IN_EVENT, watchSignInAnswers, type SignInKind } from "../lib/signInWatch";

const short = (w: string) => (w.length > 12 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w);

export default function SignInAgain() {
  const [kind, setKind] = useState<SignInKind | null>(null);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const dismissed = useRef(false);
  // the kind the card shows now (the event handler below is set up once)
  const shown = useRef<SignInKind | null>(null);
  // when the player last signed in or changed who they play as: answers to requests sent before that
  // were asked for the old sign-in (a balance read still on its way while the PIN was checked)
  const changedAt = useRef(0);
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  useEffect(() => {
    watchSignInAnswers();
    const onNeed = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (typeof d.sent === "number" && d.sent < changedAt.current) return;
      // "Not now" holds until the player tries to play with points again
      if (dismissed.current && !d.active) return;
      dismissed.current = false;
      // already asking for this sign-in: keep what the player is typing (games keep reading the balance)
      if (shown.current === d.kind) return;
      shown.current = d.kind;
      const pid = getEffectivePlayerId(loadProfile());
      if (d.kind === "name" && pid.startsWith("name:")) setName((n) => n || pid.slice(5));
      setMsg("");
      setKind(d.kind);
    };
    const onChanged = () => { changedAt.current = performance.now(); };
    window.addEventListener(SIGN_IN_EVENT, onNeed);
    window.addEventListener("ra:identity-changed", onChanged);
    return () => {
      window.removeEventListener(SIGN_IN_EVENT, onNeed);
      window.removeEventListener("ra:identity-changed", onChanged);
    };
  }, []);

  if (!kind) return null;

  const prof = loadProfile();
  const pid = getEffectivePlayerId(prof);
  const wallet = (pid.startsWith("wallet:") ? pid.slice(7) : prof.walletAddress || "").toLowerCase();

  const done = () => {
    shown.current = null;
    setKind(null);
    setPin("");
    setMsg("");
    window.dispatchEvent(new Event("ra:identity-changed"));
  };

  const discord = () => {
    window.location.href = "/api/auth/discord/login?returnTo=" + encodeURIComponent(window.location.pathname + window.location.search);
  };

  const signInName = async () => {
    if (!name.trim() || !pin.trim()) return setMsg("Enter your Commander name and PIN.");
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/commander/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), pin: pin.trim() }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) {
        // the same profile the home page's sign-in keeps
        saveProfile({ primaryId: j.playerId, name: j.displayName || j.name, discordSkipLink: true });
        return done();
      }
      setPin("");
      // a name from before PINs gets its first PIN from the team (lib/commanderPins.ts): the answer says so
      setMsg(j?.error || "Could not sign in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const signInWallet = async () => {
    if (!address) return setMsg("Connect your wallet first.");
    const guestId = String(prof.id || "").trim();
    const w = address.toLowerCase();
    setBusy(true);
    setMsg("");
    try {
      const nr = await fetch(`/api/identity/nonce?guestId=${encodeURIComponent(guestId)}&walletAddress=${encodeURIComponent(w)}`, { cache: "no-store" });
      const nj = await nr.json().catch(() => null);
      if (!nr.ok || !nj?.nonce) return setMsg(nj?.error || "Could not start the wallet sign-in.");
      const message = `Rebel Ants Link Wallet\nGuest: ${guestId}\nWallet: ${w}\nNonce: ${String(nj.nonce)}`;
      const signature = await signMessageAsync({ message });
      const r = await fetch("/api/identity/link-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId, walletAddress: w, nonce: String(nj.nonce), signature }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) {
        // as the Link Wallet button: a Discord identity stays the primary one
        const primary = String(loadProfile().primaryId || "");
        saveProfile(primary.startsWith("discord:") ? { walletAddress: w } : { walletAddress: w, primaryId: String(j.playerId || `wallet:${w}`) });
        return done();
      }
      setMsg(j?.error || "Could not sign in with the wallet.");
    } catch {
      setMsg("The wallet did not sign. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const wrongWallet = !!(wallet && address && address.toLowerCase() !== wallet);

  return (
    <div className="ra-signin" role="dialog" aria-live="polite">
      <div className="ra-signin-title">Sign in again</div>
      <div className="ra-signin-text">
        To keep your $REBEL safe, points only move for a player signed in on this device. Sign in once more to keep playing.
      </div>

      {kind === "discord" && (
        <div className="ra-signin-row">
          <button className="ra-signin-btn main" type="button" onClick={discord}>Sign in with Discord</button>
        </div>
      )}

      {kind === "name" && (
        <form className="ra-signin-row" onSubmit={(e) => { e.preventDefault(); void signInName(); }}>
          <input className="ra-signin-in" value={name} onChange={(e) => setName(e.target.value)} placeholder="Commander name" autoComplete="username" />
          <input className="ra-signin-in pin" value={pin} onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
            placeholder="PIN" inputMode="numeric" type="password" autoComplete="current-password" />
          <button className="ra-signin-btn main" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      )}

      {kind === "wallet" && (
        <div className="ra-signin-row">
          {!isConnected ? (
            <ConnectButton />
          ) : (
            <button className="ra-signin-btn main" type="button" onClick={signInWallet} disabled={busy || wrongWallet}>
              {busy ? "Check your wallet…" : "Sign with your wallet"}
            </button>
          )}
          {wallet ? <span className="ra-signin-note">{wrongWallet ? `Connect ${short(wallet)}, the wallet you play with.` : short(wallet)}</span> : null}
        </div>
      )}

      {msg && <div className="ra-signin-msg">{msg}</div>}

      <button className="ra-signin-btn later" type="button" onClick={() => { dismissed.current = true; shown.current = null; setKind(null); }}>Not now</button>

      <style jsx>{`
        .ra-signin {
          position: fixed;
          left: 50%;
          bottom: max(12px, env(safe-area-inset-bottom));
          transform: translateX(-50%);
          z-index: 2100;
          width: min(560px, calc(100vw - 24px));
          box-sizing: border-box;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(15, 23, 42, 0.97);
          box-shadow: 0 28px 60px rgba(0, 0, 0, 0.55);
          padding: 14px 16px;
          color: white;
        }
        .ra-signin-title { font-weight: 900; font-size: 16px; }
        .ra-signin-text { margin-top: 6px; font-size: 13px; opacity: 0.9; line-height: 1.45; }
        .ra-signin-row { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .ra-signin-in {
          flex: 1 1 140px;
          min-width: 0;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(2, 6, 23, 0.7);
          color: white;
          font-size: 16px;
        }
        .ra-signin-in.pin { flex: 0 1 96px; }
        .ra-signin-btn {
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(15, 23, 42, 0.7);
          color: white;
          font-weight: 800;
          cursor: pointer;
          padding: 10px 14px;
          font-size: 14px;
        }
        .ra-signin-btn.main { background: #5865f2; border-color: #5865f2; }
        .ra-signin-btn:disabled { opacity: 0.6; cursor: default; }
        .ra-signin-btn.later { margin-top: 10px; padding: 6px 10px; font-size: 12px; opacity: 0.8; }
        .ra-signin-note { font-size: 12px; opacity: 0.85; }
        .ra-signin-msg { margin-top: 8px; font-size: 12px; color: #fca5a5; }
      `}</style>
    </div>
  );
}
