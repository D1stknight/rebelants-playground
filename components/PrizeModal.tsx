import React, { useMemo, useState } from "react";

type Shipping = {
  name: string;
  email: string;
  phone: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  label: string;
  sub?: string;
  children?: React.ReactNode;

  // ✅ OPTIONAL (backwards compatible)
  // If provided and merchNeedsShipping=true, we render the shipping form automatically.
  merchNeedsShipping?: boolean;
  claimId?: string;
  playerId?: string;

  // Called when shipping successfully saved
  onShippingSaved?: (updatedClaim: any) => void;
};

export default function PrizeModal({
  open,
  onClose,
  label,
  sub,
  children,
  merchNeedsShipping,
  claimId,
  playerId,
  onShippingSaved,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");
  const [okMsg, setOkMsg] = useState<string>("");

  const [shipping, setShipping] = useState<Shipping>({
    name: "",
    email: "",
    phone: "",
    address1: "",
    address2: "",
    city: "",
    state: "",
    zip: "",
    country: "US",
  });

  const canShowShippingForm = useMemo(() => {
    return !!merchNeedsShipping && !!claimId && !!playerId;
  }, [merchNeedsShipping, claimId, playerId]);

  async function submitShipping() {
    setErr("");
    setOkMsg("");

    if (!claimId || !playerId) {
      setErr("Missing claimId/playerId — cannot submit shipping.");
      return;
    }

    // super basic validation
    if (
      !shipping.name ||
      !shipping.email ||
      !shipping.address1 ||
      !shipping.city ||
      !shipping.state ||
      !shipping.zip ||
      !shipping.country
    ) {
      setErr("Please fill out all required fields.");
      return;
    }

    setBusy(true);
    try {
      const r = await fetch("/api/prizes/shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimId,
          playerId,
          shipping,
        }),
      });

      const text = await r.text();
      const j = text ? JSON.parse(text) : null;

      if (!r.ok || !j?.ok) {
        setErr(j?.error || `Shipping submit failed (status ${r.status})`);
        return;
      }

      setOkMsg("Shipping received ✅");
      if (onShippingSaved) onShippingSaved(j.claim);
    } catch (e: any) {
      setErr(e?.message || "Shipping submit failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal">
      <div className="modal-card ant-card">
        <h3 className="title mb-1">{label}</h3>
        {sub && <p className="subtitle mb-3">{sub}</p>}

        {/* If merch needs shipping, show the form automatically */}
        {canShowShippingForm ? (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Shipping Info</div>

            {err && (
              <div style={{ marginBottom: 10, opacity: 0.95 }}>
                ❌ {err}
              </div>
            )}
            {okMsg && (
              <div style={{ marginBottom: 10, opacity: 0.95 }}>
                ✅ {okMsg}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input
                value={shipping.name}
                onChange={(e) => setShipping((s) => ({ ...s, name: e.target.value }))}
                placeholder="Full name *"
                className="input"
              />
              <input
                value={shipping.email}
                onChange={(e) => setShipping((s) => ({ ...s, email: e.target.value }))}
                placeholder="Email *"
                className="input"
              />
              <input
                value={shipping.phone}
                onChange={(e) => setShipping((s) => ({ ...s, phone: e.target.value }))}
                placeholder="Phone"
                className="input"
              />
              <input
                value={shipping.country}
                onChange={(e) => setShipping((s) => ({ ...s, country: e.target.value }))}
                placeholder="Country (US) *"
                className="input"
              />
              <input
                value={shipping.address1}
                onChange={(e) => setShipping((s) => ({ ...s, address1: e.target.value }))}
                placeholder="Address line 1 *"
                className="input"
                style={{ gridColumn: "1 / -1" }}
              />
              <input
                value={shipping.address2 || ""}
                onChange={(e) => setShipping((s) => ({ ...s, address2: e.target.value }))}
                placeholder="Address line 2"
                className="input"
                style={{ gridColumn: "1 / -1" }}
              />
              <input
                value={shipping.city}
                onChange={(e) => setShipping((s) => ({ ...s, city: e.target.value }))}
                placeholder="City *"
                className="input"
              />
              <input
                value={shipping.state}
                onChange={(e) => setShipping((s) => ({ ...s, state: e.target.value }))}
                placeholder="State/Province *"
                className="input"
              />
              <input
                value={shipping.zip}
                onChange={(e) => setShipping((s) => ({ ...s, zip: e.target.value }))}
                placeholder="ZIP/Postal *"
                className="input"
              />
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12, justifyContent: "flex-end" }}>
              <button
                className="btn"
                onClick={submitShipping}
                disabled={busy}
                style={{ padding: "10px 12px" }}
              >
                {busy ? "Submitting…" : "Submit Shipping"}
              </button>
              <button onClick={onClose} className="btn" style={{ padding: "10px 12px" }}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            {children}
            <div className="text-right mt-4">
              <button onClick={onClose} className="btn">
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
