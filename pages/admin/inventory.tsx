// pages/admin/inventory.tsx
import React from "react";
import Link from "next/link";

export default function AdminInventoryPage() {
  const [adminKey, setAdminKey] = React.useState("");
  const [status, setStatus] = React.useState<string>("");

  const [summary, setSummary] = React.useState<any>({ nfts: [], merch: [] });

  // NFT form
  const [chain, setChain] = React.useState<"ETH" | "APECHAIN">("APECHAIN");
  const [contract, setContract] = React.useState("");
  const [tokenIds, setTokenIds] = React.useState("");

  // Merch form
  const [sku, setSku] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [qty, setQty] = React.useState(1);

  async function loadSummary() {
    setStatus("");
    try {
      const r = await fetch("/api/admin/inventory/summary", {
        headers: { "x-admin-key": adminKey },
        cache: "no-store",
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setStatus(j?.error || "Could not load summary");
        return;
      }
      setSummary(j);
    } catch {
      setStatus("Load failed");
    }
  }

  async function addNfts() {
    setStatus("");
    try {
      const r = await fetch("/api/admin/inventory/nft/add", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ chain, contract, tokenIds }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setStatus(j?.error || "NFT add failed");
        return;
      }
      setStatus(`✅ Added ${j.added} NFTs`);
      await loadSummary();
    } catch {
      setStatus("NFT add failed");
    }
  }

  async function addMerch() {
    setStatus("");
    try {
      const r = await fetch("/api/admin/inventory/merch/add", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ sku, label, qty }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setStatus(j?.error || "Merch add failed");
        return;
      }
      setStatus(`✅ Merch updated: ${j.sku} qty=${j.qty}`);
      await loadSummary();
    } catch {
      setStatus("Merch add failed");
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: "24px auto", padding: 16, color: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ fontWeight: 900, fontSize: 20 }}>Admin • Inventory</div>
        <Link href="/admin" style={{ textDecoration: "underline", opacity: 0.9 }}>
          ← Back to Admin
        </Link>
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        <label style={{ fontSize: 13, opacity: 0.9 }}>
          Admin Key:
          <input
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            style={{
              width: "100%",
              marginTop: 6,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,.18)",
              background: "rgba(15,23,42,.65)",
              color: "white",
              fontWeight: 700,
            }}
          />
        </label>

        <button className="btn" onClick={loadSummary}>
          Load Inventory Summary
        </button>

        {status ? <div style={{ fontSize: 13, opacity: 0.9 }}>{status}</div> : null}
      </div>

      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* NFT preload */}
        <div className="card">
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Preload NFTs</div>

          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ fontSize: 13, opacity: 0.9 }}>
              Chain
              <select
                value={chain}
                onChange={(e) => setChain(e.target.value as any)}
                style={inputStyle}
              >
                <option value="APECHAIN">ApeChain</option>
                <option value="ETH">Ethereum</option>
              </select>
            </label>

            <label style={{ fontSize: 13, opacity: 0.9 }}>
              Contract (0x…)
              <input value={contract} onChange={(e) => setContract(e.target.value)} style={inputStyle} />
            </label>

            <label style={{ fontSize: 13, opacity: 0.9 }}>
              Token IDs (comma or space separated)
              <textarea
                value={tokenIds}
                onChange={(e) => setTokenIds(e.target.value)}
                rows={5}
                style={{ ...inputStyle, resize: "vertical" as const }}
              />
            </label>

            <button className="btn" onClick={addNfts}>
              Add NFTs to Inventory
            </button>
          </div>
        </div>

        {/* Merch preload */}
        <div className="card">
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Preload Merch Stock</div>

          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ fontSize: 13, opacity: 0.9 }}>
              SKU
              <input value={sku} onChange={(e) => setSku(e.target.value)} style={inputStyle} />
            </label>

            <label style={{ fontSize: 13, opacity: 0.9 }}>
              Label
              <input value={label} onChange={(e) => setLabel(e.target.value)} style={inputStyle} />
            </label>

            <label style={{ fontSize: 13, opacity: 0.9 }}>
              Qty
              <input
                value={String(qty)}
                type="number"
                min={1}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value || 1)))}
                style={inputStyle}
              />
            </label>

            <button className="btn" onClick={addMerch}>
              Add Merch Stock
            </button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }} className="card">
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Current Inventory</div>

        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>NFT Collections</div>
            {(summary?.nfts || []).length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {summary.nfts.map((x: any, i: number) => (
                  <div key={i} style={{ padding: 10, borderRadius: 12, background: "rgba(15,23,42,.35)" }}>
                    <div style={{ fontWeight: 800 }}>
                      {x.chain} • {x.contract}
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.9 }}>
                      Available: <b>{x.available}</b> • Claimed: <b>{x.claimed}</b>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, opacity: 0.8 }}>No NFT collections registered yet.</div>
            )}
          </div>

          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Merch SKUs</div>
            {(summary?.merch || []).length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {summary.merch.map((x: any, i: number) => (
                  <div key={i} style={{ padding: 10, borderRadius: 12, background: "rgba(15,23,42,.35)" }}>
                    <div style={{ fontWeight: 800 }}>
                      {x.label} <span style={{ opacity: 0.8 }}>({x.sku})</span>
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.9 }}>
                      Qty: <b>{x.qty}</b>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, opacity: 0.8 }}>No merch SKUs registered yet.</div>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        .card {
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 16px;
          background: rgba(0, 0, 0, 0.25);
          padding: 14px;
        }
        .btn {
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(15, 23, 42, 0.7);
          color: white;
          font-weight: 900;
          cursor: pointer;
          padding: 10px 12px;
        }
        .btn:hover {
          background: rgba(15, 23, 42, 0.9);
        }
      `}</style>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,.18)",
  background: "rgba(15,23,42,.65)",
  color: "white",
  fontWeight: 700,
};
