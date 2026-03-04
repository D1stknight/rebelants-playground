// components/BuyPointsModal.tsx
import React, { useMemo, useState, useEffect, useRef } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useBalance,
  useWriteContract,
  useWaitForTransactionReceipt,
  useChainId,
  useSwitchChain,
} from "wagmi";
import { apeChain } from "../lib/apechain";
import { loadProfile, saveProfile } from "../lib/profile";
import { useSignMessage } from "wagmi";

const SHOP_ADDRESS = (process.env.NEXT_PUBLIC_APECHAIN_SHOP_ADDRESS || "").toLowerCase();

const SHOP_ABI = [
  {
    type: "function",
    name: "buyStarter",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "buyValue",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "buyWhale",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
] as const;

function toWei(ape: number) {
  // APE has 18 decimals
  return BigInt(Math.floor(ape * 1e6)) * 10n ** 12n; // safe-ish conversion for .xx
}

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
  
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
const { signMessageAsync } = useSignMessage();
  const [status, setStatus] = useState<string>("");
  const [lastTx, setLastTx] = useState<`0x${string}` | null>(null);

  // when a tx is mined, we claim exactly once
  const claimOnceRef = useRef<Record<string, boolean>>({});

  // ✅ Live ApeChain balance
  const {
    data: apeBal,
    refetch: refetchApeBal,
    isFetching: fetchingBal,
  } = useBalance({
    address,
    chainId: apeChain.id,
    query: { enabled: !!address, refetchInterval: 15000 },
  });

  const isOnApeChain = chainId === apeChain.id;

  // ✅ Track tx confirmation
  const {
    isLoading: confirmingTx,
    isSuccess: txMined,
  } = useWaitForTransactionReceipt({
    hash: lastTx ?? undefined,
    chainId: apeChain.id,
    query: { enabled: !!lastTx },
  });

  // ✅ When mined, claim points (prevents “no logs yet” race)
  useEffect(() => {
    if (!lastTx) return;
    if (!txMined) return;
    if (!address) return;

    const key = lastTx.toLowerCase();
    if (claimOnceRef.current[key]) return;
    claimOnceRef.current[key] = true;

    (async () => {
      try {
        setStatus("Confirmed ✅ Claiming points…");

        const r = await fetch("/api/shop/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txHash: lastTx,
            playerId,
            walletAddress: address,
          }),
        });

        const j = await r.json().catch(() => null);

        if (!r.ok) {
          setStatus(`Claim failed: ${j?.error || "Unknown error"}`);
          return;
        }

        if (j?.alreadyClaimed) {
          setStatus("Already claimed ✅ Balance refreshed.");
        } else {
          setStatus("Success ✅ Points credited!");
        }

        await refetchApeBal();
        await onClaimed();
      } catch (e: any) {
        setStatus(`Claim error: ${e?.message || "Unknown error"}`);
      }
    })();
  }, [txMined, lastTx, address, playerId, onClaimed, refetchApeBal]);
  const packs = useMemo(
    () => [
      { id: 1, name: "Starter Pack", ape: 50, points: 2500, fn: "buyStarter" as const },
      { id: 2, name: "Value Pack", ape: 200, points: 11000, fn: "buyValue" as const },
      { id: 3, name: "Whale Pack", ape: 1000, points: 60000, fn: "buyWhale" as const },
    ],
    []
  );

   async function buyPack(fnName: "buyStarter" | "buyValue" | "buyWhale", apeAmount: number) {
    if (!SHOP_ADDRESS) {
      setStatus("Missing NEXT_PUBLIC_APECHAIN_SHOP_ADDRESS (set it in Vercel env vars).");
      return;
    }
    if (!address) {
      setStatus("Connect a wallet first.");
      return;
    }

    try {
      setStatus("Sending transaction…");

      const hash = await writeContractAsync({
        address: SHOP_ADDRESS as `0x${string}`,
        abi: SHOP_ABI,
        functionName: fnName,
        value: toWei(apeAmount),
      });

      setLastTx(hash);
      setStatus("Transaction sent. Waiting for confirmation…");
    } catch (e: any) {
      setStatus(`Error: ${e?.shortMessage || e?.message || "Unknown error"}`);
    }
  }

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
          <div style={{ fontWeight: 900, fontSize: 16 }}>Buy Points (APE → REBEL Points)</div>
          <button className="btn" onClick={onClose} style={{ padding: "8px 12px" }}>
            Close
          </button>
        </div>

       <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9, lineHeight: 1.4 }}>
  You are buying <b>REBEL Points</b> with <b>APE</b>.<br />
  APE is sent to the Rebel Ants treasury wallet.<br />
  Rate locked: <b>1 APE = 100 pts</b>. No refunds.
</div>

<div style={{ marginTop: 10, fontSize: 12, opacity: 0.85, lineHeight: 1.4 }}>
  <b>Important:</b> Points are credited to the identity you’re currently playing as.<br />
  • If you are not connected to Discord, your purchase is credited to your <b>Guest ID</b> on this device.<br />
  • If you connect Discord, your points follow your <b>Discord identity</b> across devices.<br />
  <span style={{ opacity: 0.9 }}>
    Joining Discord is recommended for account recovery, cross-device play, and community perks.
  </span>
</div>

        <div style={{ marginTop: 12 }}>
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
      Link Wallet (migrate points)
    </button>

    <span style={{ fontSize: 12, opacity: 0.85 }}>
      This is one-time. After linking, your points follow this wallet.
    </span>
  </div>
) : null}
        
        {/* ✅ INSERT THIS BLOCK RIGHT HERE */}
<div style={{
  marginTop: 10,
  fontSize: 13,
  opacity: 0.9,
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  alignItems: "center"
}}>
  <span>
    Network:{" "}
    {isConnected ? (
      isOnApeChain ? (
        <b>ApeChain ✅</b>
      ) : (
        <b style={{ color: "#fca5a5" }}>Wrong network ❌</b>
      )
    ) : (
      <b>Not connected</b>
    )}
  </span>

  {isConnected && !isOnApeChain && (
    <button
      className="btn"
      type="button"
      onClick={async () => {
        setStatus("Switching to ApeChain…");
        await switchChainAsync({ chainId: apeChain.id });
        setStatus("");
      }}
      style={{ padding: "8px 12px", fontSize: 13 }}
    >
      Switch to ApeChain
    </button>
  )}

  {address && (
    <button
      className="btn"
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(address);
        setStatus("Wallet copied ✅");
        setTimeout(() => setStatus(""), 1200);
      }}
      style={{ padding: "8px 12px", fontSize: 13 }}
      title={address}
    >
      Copy Wallet
    </button>
  )}
</div>        
        
<div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>
  {address ? (
    <>
      APE Balance (live):{" "}
      <b>
        {apeBal ? Number(apeBal.formatted).toFixed(4) : "—"} {apeBal?.symbol || "APE"}
      </b>
      {fetchingBal ? " (updating…)" : ""}
      {confirmingTx ? " (confirming tx…)" : ""}
    </>
  ) : (
    "Connect your wallet to see your APE balance."
  )}
</div>

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {packs.map((p) => (
            <button
              key={p.id}
              className="btn"
              disabled={!isConnected || !isOnApeChain || isPending || confirmingTx}
              onClick={() => buyPack(p.fn, p.ape)}
              style={{ padding: "12px 12px", textAlign: "left" }}
              title={!isConnected ? "Connect wallet first" : ""}
            >
              <div style={{ fontWeight: 900 }}>{p.name}</div>
              <div style={{ fontSize: 13, opacity: 0.9 }}>
                Pay <b>{p.ape} APE</b> → get <b>{p.points.toLocaleString()} pts</b>
              </div>
            </button>
          ))}
        </div>

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
        `}</style>
      </div>
    </div>
  );
}
