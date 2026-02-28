// components/BuyPointsModal.tsx
import React, { useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useBalance, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { apeChain } from "../lib/apechain";

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
const { writeContractAsync, isPending } = useWriteContract();

const [status, setStatus] = useState<string>("");
const [lastTx, setLastTx] = useState<`0x${string}` | null>(null);

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

// ✅ Track tx confirmation
const { isLoading: confirmingTx } = useWaitForTransactionReceipt({
  hash: lastTx ?? undefined,
  chainId: apeChain.id,
  query: { enabled: !!lastTx },
});

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
await refetchApeBal();

      setStatus("Transaction sent. Claiming points…");

      const r = await fetch("/api/shop/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: hash,
          playerId,
          walletAddress: address,
        }),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok) {
        setStatus(`Claim failed: ${j?.error || "Unknown error"}`);
        return;
      }

      setStatus("Success ✅ Points credited!");
      await onClaimed();
    } catch (e: any) {
      setStatus(`Error: ${e?.shortMessage || e?.message || "Unknown error"}`);
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

        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>
          Rate locked: <b>1 APE = 100 pts</b>. No refunds.
        </div>

        <div style={{ marginTop: 12 }}>
  <ConnectButton />
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
              disabled={!isConnected || isPending}
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
