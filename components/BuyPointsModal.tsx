// components/BuyPointsModal.tsx
import React, { useEffect, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";
import { loadProfile, saveProfile } from "../lib/profile";

// Buying points (Oct 20): one shop for every Rebel Ants app, the Rebel Economy's (packs by card, in APE or
// in ETH), opened in a new tab through /api/shop/open (signed in when we know the player). Points bought
// there go to the Rebel account and add bonus plays here (lib/server/purchasedPlays.ts), as the old APE
// packs did. The wallet stays here for prizes and payouts (Link Wallet).

export default function BuyPointsModal({
  open,
  onClose,
  playerId,
  onClaimed,
}: {
  open: boolean;
  onClose: () => void;
  playerId: string;
  onClaimed: () => Promise<void> | void;
}) {
  const { address, isConnected } = useAccount();

// ✅ Persist connected wallet into profile so the whole app can use it as identity
useEffect(() => {
  if (typeof window === "undefined") return;

  // CONNECTED
  if (address) {
    const normalized = address.toLowerCase();
    saveProfile({ walletAddress: normalized });

    window.dispatchEvent(
      new CustomEvent("ra:identity-changed", {
        detail: { walletAddress: normalized },
      })
    );
    return;
  }

  // DISCONNECTED
  saveProfile({ walletAddress: undefined });

  window.dispatchEvent(
    new CustomEvent("ra:identity-changed", {
      detail: { walletAddress: null },
    })
  );
}, [address]);
  
  const { signMessageAsync } = useSignMessage();
  const [status, setStatus] = useState<string>("");

  // back from the shop's tab: read the balance and the bonus plays again (once per visit to the shop)
  const shopOpened = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const back = () => {
      if (!shopOpened.current || document.visibilityState === "hidden") return;
      shopOpened.current = false;
      setStatus("Welcome back: your points and bonus plays are up to date.");
      void onClaimed();
    };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, [onClaimed]);

  const shopHref = () =>
    typeof window === "undefined" ? "/api/shop/open" : "/api/shop/open?return=" + encodeURIComponent(location.pathname + location.search);

async function linkWalletNow() {
  if (!address) {
    setStatus("Connect a wallet first.");
    return;
  }

  try {
    const prof = loadProfile();
    const guestId = String(prof.id || "").trim();
    const wallet = address.toLowerCase();

    if (!guestId) {
      setStatus("Missing guest id.");
      return;
    }

    setStatus("Preparing link (nonce)…");

    const nr = await fetch(
      `/api/identity/nonce?guestId=${encodeURIComponent(guestId)}&walletAddress=${encodeURIComponent(wallet)}`,
      { method: "GET", cache: "no-store" }
    );
    const nj = await nr.json().catch(() => null);

    if (!nr.ok || !nj?.nonce) {
      setStatus(`Nonce error: ${nj?.error || "Unknown error"}`);
      return;
    }

    const nonce = String(nj.nonce);

    const message =
      `Rebel Ants Link Wallet\n` +
      `Guest: ${guestId}\n` +
      `Wallet: ${wallet}\n` +
      `Nonce: ${nonce}`;

    setStatus("Signing message…");
    const sig = await signMessageAsync({ message });

    setStatus("Linking + migrating points…");
    const r = await fetch("/api/identity/link-wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestId, walletAddress: wallet, nonce, signature: sig }),
    });

    const j = await r.json().catch(() => null);

    if (!r.ok || !j?.ok) {
      setStatus(`Link failed: ${j?.error || "Unknown error"}`);
      return;
    }

    const current = loadProfile();
const currentPrimary = String(current.primaryId || "").trim();
const newPid = String(j.playerId || `wallet:${wallet}`);

// ✅ If Discord is already primary, do NOT overwrite it
if (currentPrimary.startsWith("discord:")) {
  saveProfile({ walletAddress: wallet });
} else {
  saveProfile({ walletAddress: wallet, primaryId: newPid });
}

// force identity refresh
if (typeof window !== "undefined") {
  window.dispatchEvent(new Event("ra:identity-changed"));
}

    setStatus(
      j?.alreadyLinked
        ? "Wallet already linked ✅"
        : `Linked ✅ Migrated ${j?.migrated?.balance ?? 0} points`
    );

    await onClaimed();
  } catch (e: any) {
    setStatus(`Link error: ${e?.shortMessage || e?.message || "Unknown error"}`);
  }
}
  
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(0,0,0,.55)",
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          width: "min(560px, 95vw)",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,.18)",
          background: "rgba(15,23,42,.96)",
          boxShadow: "0 28px 60px rgba(0,0,0,.55)",
          padding: 16,
          color: "white",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Buy Rebel Points</div>
          <button className="btn" onClick={onClose} style={{ padding: "8px 12px" }}>
            Close
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9, lineHeight: 1.5 }}>
          Packs by card, in APE or in ETH, in the Rebel Ants shop (the same one as After Dark and Rebel Universe).
          Points go to your Rebel account and add bonus plays here: keep playing past the daily limit.
        </div>

        <a
          className="btn shop"
          href={shopHref()}
          target="_blank"
          // with an opener: the shop's Back then closes its tab, even after a card payment, instead of opening this page again in it
          rel="opener"
          onClick={() => {
            shopOpened.current = true;
            setStatus("The shop opened in a new tab. Come back here when you are done.");
          }}
        >
          Open the points shop
        </a>

        <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,.12)", fontSize: 13, opacity: 0.9 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Wallet for prizes and rewards</div>
          <ConnectButton />
        </div>

        {isConnected && address ? (
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              className="btn"
              type="button"
              onClick={linkWalletNow}
              style={{ padding: "10px 12px", fontSize: 13 }}
              title="One-time link: migrates guest points to wallet identity"
            >
              Link Wallet for Payments and Prizes
            </button>
            <button
              className="btn"
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(address);
                setStatus("Wallet copied ✅");
                setTimeout(() => setStatus(""), 1200);
              }}
              style={{ padding: "10px 12px", fontSize: 13 }}
              title={address}
            >
              Copy Wallet
            </button>
            <span style={{ fontSize: 12, opacity: 0.85 }}>
              This is one-time. After linking, your points follow this wallet.
            </span>
          </div>
        ) : null}

        {status && (
          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.9, whiteSpace: "pre-wrap" }}>{status}</div>
        )}

        <style jsx>{`
          .btn {
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.18);
            background: rgba(15, 23, 42, 0.7);
            color: white;
            font-weight: 800;
            cursor: pointer;
          }
          .btn:hover {
            background: rgba(15, 23, 42, 0.9);
          }
          .btn:disabled {
            opacity: 0.55;
            cursor: not-allowed;
          }
          .shop {
            display: block;
            margin-top: 14px;
            padding: 14px 12px;
            text-align: center;
            text-decoration: none;
            font-size: 15px;
            background: linear-gradient(135deg, #d4a017, #8a5e1a);
            border-color: rgba(212, 160, 23, 0.6);
            color: #070a12;
          }
          .shop:hover {
            background: linear-gradient(135deg, #e0b02a, #9a6a1f);
          }
        `}</style>
      </div>
    </div>
  );
}
