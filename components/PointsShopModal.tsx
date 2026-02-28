// components/PointsShopModal.tsx
import React, { useEffect } from "react";

type Pack = {
  id: 1 | 2 | 3;
  title: string;
  ape: number;
  points: number;
  shuffles?: number;
  bonusNote?: string;
};

const PACKS: Pack[] = [
  { id: 1, title: "Starter Pack", ape: 50, points: 2500, shuffles: 5 },
  { id: 2, title: "Value Pack", ape: 200, points: 11000, shuffles: 22, bonusNote: "Includes a small bonus" },
  { id: 3, title: "Whale Pack", ape: 1000, points: 60000, shuffles: 120, bonusNote: "Bonus baked in" },
];

export default function PointsShopModal(props: {
  open: boolean;
  onClose: () => void;

  // We’ll wire these next once wallet connect is in:
  onConnect?: () => void;
  connectedWallet?: string | null;
  onBuyPack?: (packId: 1 | 2 | 3) => void;

  loading?: boolean;
  statusText?: string;
}) {
  const { open, onClose } = props;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onMouseDown={(e) => {
        // close if you click the backdrop (not the card)
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(720px, 96vw)",
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,.16)",
          background: "rgba(15,23,42,.92)",
          boxShadow: "0 20px 80px rgba(0,0,0,.55)",
          color: "white",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>Buy Points (APE)</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
              No refunds. Points are credited after the transaction is confirmed.
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,.18)",
              background: "rgba(0,0,0,.25)",
              color: "white",
              padding: "8px 10px",
              cursor: "pointer",
              fontWeight: 900,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 16, paddingTop: 0 }}>
          {/* Connect row (we’ll wire later) */}
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 12,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,.12)",
              background: "rgba(0,0,0,.20)",
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.9 }}>
              Wallet:{" "}
              <b style={{ opacity: 1 }}>
                {props.connectedWallet ? props.connectedWallet : "Not connected"}
              </b>
              {!props.connectedWallet && (
                <span style={{ marginLeft: 8, opacity: 0.75 }}>(We’ll connect Coinbase Wallet next)</span>
              )}
            </div>

            <button
              type="button"
              className="raBtn"
              onClick={() => props.onConnect?.()}
              disabled={!!props.connectedWallet || props.loading}
              style={{ opacity: !!props.connectedWallet ? 0.55 : 1 }}
            >
              {props.connectedWallet ? "Connected" : "Connect Wallet"}
            </button>
          </div>

          {/* Packs */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
            {PACKS.map((p) => (
              <div
                key={p.id}
                style={{
                  padding: 14,
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,.14)",
                  background: "rgba(0,0,0,.18)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontWeight: 900, fontSize: 14 }}>
                    {p.title} — <span style={{ opacity: 0.9 }}>{p.ape} APE</span>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                    Earn <b>{p.points.toLocaleString()} pts</b>
                    {p.shuffles ? <span> (~{p.shuffles} shuffles)</span> : null}
                    {p.bonusNote ? <span style={{ marginLeft: 8, opacity: 0.85 }}>• {p.bonusNote}</span> : null}
                  </div>
                </div>

                <button
                  type="button"
                  className="raBtn"
                  disabled={!props.connectedWallet || props.loading}
                  onClick={() => props.onBuyPack?.(p.id)}
                  title={!props.connectedWallet ? "Connect your wallet first" : "Buy pack"}
                >
                  Buy
                </button>
              </div>
            ))}
          </div>

          {/* Status */}
          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.85, minHeight: 18 }}>
            {props.statusText ? props.statusText : ""}
          </div>
        </div>

        <style jsx>{`
          .raBtn {
            padding: 10px 12px;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.18);
            background: rgba(15, 23, 42, 0.7);
            color: white;
            font-weight: 900;
            cursor: pointer;
          }
          .raBtn:hover {
            background: rgba(15, 23, 42, 0.92);
          }
          .raBtn:disabled {
            cursor: not-allowed;
            opacity: 0.55;
          }
        `}</style>
      </div>
    </div>
  );
}
