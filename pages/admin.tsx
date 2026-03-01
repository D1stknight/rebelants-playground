// pages/admin.tsx
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { pointsConfig as defaultConfig } from "../lib/pointsConfig";

type PointsConfigShape = {
  currency: string;
  shuffleCost: number;
  dailyClaim: number;
  dailyEarnCap: number;
  rewards: { none: number; common: number; rare: number; ultra: number };

  // ✅ NEW
  ultraMinReward: number;

  prizePools?: {
    none: any[];
    common: any[];
    rare: any[];
    ultra: any[];
  };
};

function safeNum(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);

    // grant
  const [playerId, setPlayerId] = useState("guest");
  const [walletAddress, setWalletAddress] = useState("");
  const [amount, setAmount] = useState(5000);

  // config form
 const [cfg, setCfg] = useState<PointsConfigShape>(() => ({
  currency: defaultConfig.currency,
  shuffleCost: defaultConfig.shuffleCost,
  dailyClaim: defaultConfig.dailyClaim,
  dailyEarnCap: defaultConfig.dailyEarnCap,
  rewards: { ...defaultConfig.rewards },

  // ✅ NEW (fallback if missing)
  ultraMinReward: Number((defaultConfig as any).ultraMinReward ?? 50),

  prizePools: (defaultConfig as any).prizePools || {
    none: [],
    common: [],
    rare: [],
    ultra: [],
  },
}));

  const [log, setLog] = useState<string>("");

   const headers = useMemo(() => {
    return {
      "Content-Type": "application/json",
      "x-admin-key": token,
      "x-admin-token": token,
    };
  }, [token]);

  function append(msg: string) {
    setLog((s) => `${msg}\n\n${s}`.trim());
  }

  useEffect(() => {
    const t = sessionStorage.getItem("ra_admin_token") || "";
    if (t) setToken(t);
  }, []);

  useEffect(() => {
    if (token) sessionStorage.setItem("ra_admin_token", token);
  }, [token]);

  async function ping() {
    setAuthed(false);
    append("Pinging auth…");
    const r = await fetch("/api/admin/ping", { headers });
    const j = await r.json().catch(() => null);
    append(`PING status ${r.status}\n${JSON.stringify(j, null, 2)}`);
    setAuthed(r.ok);
  }

  async function loadConfig() {
  append("Loading config…");
  const r = await fetch("/api/admin/config", { method: "GET", headers });
  const j = await r.json().catch(() => null);
  append(`CONFIG status ${r.status}\n${JSON.stringify(j, null, 2)}`);

  const merged = (j?.config ?? j?.pointsConfig) as PointsConfigShape | undefined;
  if (merged) setCfg(merged);
}

  async function saveConfig() {
  append("Saving config…");
  const r = await fetch("/api/admin/config", {
    method: "POST",
    headers,
    body: JSON.stringify(cfg),
  });
  const j = await r.json().catch(() => null);
  append(`SAVE CONFIG status ${r.status}\n${JSON.stringify(j, null, 2)}`);

  const merged = (j?.config ?? j?.pointsConfig) as PointsConfigShape | undefined;
  if (merged) setCfg(merged);
}

    async function grantPoints() {
    append("Granting points…");
    const payload: any = { amount };

    const w = (walletAddress || "").trim();
    if (w) payload.walletAddress = w;
    else payload.playerId = playerId;

    const r = await fetch("/api/admin/grant", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => null);
    append(`GRANT status ${r.status}\n${JSON.stringify(j, null, 2)}`);

    // if grant-by-wallet returned mapped playerId, keep UI in sync
    if (r.ok && j?.playerId) setPlayerId(j.playerId);
  }

      async function lookupWallet() {
    append("Looking up wallet…");
    const w = (walletAddress || "").trim();
    if (!w) {
      append("Wallet lookup: missing walletAddress");
      return;
    }

    const r = await fetch(`/api/admin/wallet?walletAddress=${encodeURIComponent(w)}`, { headers });
    const j = await r.json().catch(() => null);
    append(`WALLET LOOKUP status ${r.status}\n${JSON.stringify(j, null, 2)}`);

    if (r.ok && j?.playerId) {
      setPlayerId(j.playerId);
    }
  }

  async function getBalance() {
    append("Getting balance…");
    const r = await fetch(`/api/points/balance?playerId=${encodeURIComponent(playerId)}`);
    const j = await r.json().catch(() => null);
    append(`BALANCE status ${r.status}\n${JSON.stringify(j, null, 2)}`);
  }

  async function clearRecentWins() {
    append("Clearing recent wins…");
    const r = await fetch("/api/admin/reset", {
      method: "POST",
      headers,
      body: JSON.stringify({ what: "recentWins" }),
    });
    const j = await r.json().catch(() => null);
    append(`RESET status ${r.status}\n${JSON.stringify(j, null, 2)}`);
  }

  async function resetLeaderboards() {
    append("Resetting leaderboards…");
    const r = await fetch("/api/admin/reset", {
      method: "POST",
      headers,
      body: JSON.stringify({ what: "leaderboards" }),
    });
    const j = await r.json().catch(() => null);
    append(`RESET status ${r.status}\n${JSON.stringify(j, null, 2)}`);
  }

  async function resetAll() {
    append("Resetting ALL…");
    const r = await fetch("/api/admin/reset", {
      method: "POST",
      headers,
      body: JSON.stringify({ what: "all" }),
    });
    const j = await r.json().catch(() => null);
    append(`RESET status ${r.status}\n${JSON.stringify(j, null, 2)}`);
  }

  return (
    <div style={{ padding: 28, color: "white", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>Rebel Ants Admin</div>
        <Link href="/" style={{ color: "white", textDecoration: "underline", opacity: 0.9 }}>
          Back to home
        </Link>
      </div>

      <div style={{ marginTop: 16, padding: 14, border: "1px solid rgba(255,255,255,.14)", borderRadius: 14, background: "rgba(15,23,42,.55)" }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Auth</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ADMIN_TOKEN"
            style={{
              width: 420,
              maxWidth: "92vw",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,.18)",
              background: "rgba(0,0,0,.25)",
              color: "white",
            }}
          />
          <button className="btn" onClick={ping} style={{ padding: "10px 12px" }}>
            Verify
          </button>
          <span style={{ opacity: 0.9 }}>
            Status: <b>{authed ? "AUTHORIZED ✅" : "NOT AUTHORIZED ❌"}</b>
          </span>
        </div>
      </div>

      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
               {/* Grant */}
        <div style={{ padding: 14, border: "1px solid rgba(255,255,255,.14)", borderRadius: 14, background: "rgba(15,23,42,.55)" }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Grant Points</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              placeholder="walletAddress (optional)"
              style={{
                width: 420,
                maxWidth: "92vw",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,.18)",
                background: "rgba(0,0,0,.25)",
                color: "white",
              }}
            />

            <button className="btn" onClick={lookupWallet} style={{ padding: "10px 12px" }}>
              Lookup Wallet → Player
            </button>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={playerId}
              onChange={(e) => setPlayerId(e.target.value)}
              placeholder="playerId (fallback)"
              style={{
                width: 240,
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,.18)",
                background: "rgba(0,0,0,.25)",
                color: "white",
              }}
            />

            <input
              value={amount}
              onChange={(e) => setAmount(safeNum(e.target.value, 0))}
              placeholder="amount"
              style={{
                width: 160,
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,.18)",
                background: "rgba(0,0,0,.25)",
                color: "white",
              }}
            />

            <button className="btn" onClick={getBalance} style={{ padding: "10px 12px" }}>
              Get Balance
            </button>

            <button className="btn" onClick={grantPoints} style={{ padding: "10px 12px" }}>
              Grant (wallet if provided)
            </button>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
            Tip: If walletAddress is filled, grants go to the linked playerId automatically. If empty, it grants to playerId.
          </div>
        </div>

        {/* Config */}
        <div style={{ padding: 14, border: "1px solid rgba(255,255,255,.14)", borderRadius: 14, background: "rgba(15,23,42,.55)" }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Economy Config</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ fontSize: 12, opacity: 0.9 }}>
              Shuffle Cost
              <input
                value={cfg.shuffleCost}
                onChange={(e) => setCfg((c) => ({ ...c, shuffleCost: safeNum(e.target.value, c.shuffleCost) }))}
                style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,.18)", background: "rgba(0,0,0,.25)", color: "white" }}
              />
            </label>

            <label style={{ fontSize: 12, opacity: 0.9 }}>
              Daily Claim
              <input
                value={cfg.dailyClaim}
                onChange={(e) => setCfg((c) => ({ ...c, dailyClaim: safeNum(e.target.value, c.dailyClaim) }))}
                style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,.18)", background: "rgba(0,0,0,.25)", color: "white" }}
              />
            </label>

            <label style={{ fontSize: 12, opacity: 0.9 }}>
              Daily Cap
              <input
                value={cfg.dailyEarnCap}
                onChange={(e) => setCfg((c) => ({ ...c, dailyEarnCap: safeNum(e.target.value, c.dailyEarnCap) }))}
                style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,.18)", background: "rgba(0,0,0,.25)", color: "white" }}
              />
            </label>

            <label style={{ fontSize: 12, opacity: 0.9 }}>
              Currency
              <input
                value={cfg.currency}
                onChange={(e) => setCfg((c) => ({ ...c, currency: e.target.value || c.currency }))}
                style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,.18)", background: "rgba(0,0,0,.25)", color: "white" }}
              />
            </label>

<label style={{ fontSize: 12, opacity: 0.9 }}>
  Ultra Min Reward
  <input
    value={cfg.ultraMinReward}
    onChange={(e) =>
      setCfg((c) => ({ ...c, ultraMinReward: safeNum(e.target.value, c.ultraMinReward) }))
    }
    style={{
      width: "100%",
      marginTop: 6,
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,.18)",
      background: "rgba(0,0,0,.25)",
      color: "white",
    }}
  />
</label>            
          </div>

       <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
  {(["none", "common", "rare", "ultra"] as const).map((k) => (
    <label key={k} style={{ fontSize: 12, opacity: 0.9 }}>
      Reward {k}
      <input
        value={cfg.rewards[k]}
        onChange={(e) =>
          setCfg((c) => ({ ...c, rewards: { ...c.rewards, [k]: safeNum(e.target.value, c.rewards[k]) } }))
        }
        style={{
          width: "100%",
          marginTop: 6,
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,.18)",
          background: "rgba(0,0,0,.25)",
          color: "white",
        }}
      />
    </label>
  ))}
</div>

          {/* Prize Pool Presets */}
<div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
  <button
    className="btn"
    type="button"
    onClick={() => {
      // House Edge: lots of NONE, small points, Ultra always something
      setCfg((c: any) => ({
        ...c,
        prizePools: {
          none: [{ type: "NONE", label: "Nothing this time", weight: 100 }],
          common: [
            { type: "NONE", label: "Nothing", weight: 85 },
            { type: "POINTS", label: "50 REBEL", points: 50, weight: 15 },
          ],
          rare: [
            { type: "NONE", label: "Nothing", weight: 90 },
            { type: "POINTS", label: "100 REBEL", points: 100, weight: 9 },
            { type: "MERCH", label: "Sticker Pack", sku: "STICKERS", qty: 10, weight: 1 },
          ],
          ultra: [
            { type: "POINTS", label: "200 REBEL", points: 200, weight: 92 },
            { type: "POINTS", label: "500 REBEL", points: 500, weight: 7 },
            { type: "MERCH", label: "T-Shirt", sku: "TSHIRT", qty: 5, weight: 1 },
          ],
        },
      }));
    }}
  >
    Preset: House Edge
  </button>

  <button
    className="btn"
    type="button"
    onClick={() => {
      // Promo Weekend: more points + a few items
      setCfg((c: any) => ({
        ...c,
        prizePools: {
          none: [{ type: "NONE", label: "Nothing this time", weight: 100 }],
          common: [
            { type: "POINTS", label: "50 REBEL", points: 50, weight: 70 },
            { type: "POINTS", label: "100 REBEL", points: 100, weight: 30 },
          ],
          rare: [
            { type: "POINTS", label: "150 REBEL", points: 150, weight: 75 },
            { type: "POINTS", label: "250 REBEL", points: 250, weight: 20 },
            { type: "MERCH", label: "Hat", sku: "HAT", qty: 3, weight: 5 },
          ],
          ultra: [
            { type: "POINTS", label: "500 REBEL", points: 500, weight: 80 },
            { type: "MERCH", label: "Hoodie", sku: "HOODIE", qty: 2, weight: 15 },
            { type: "APE", label: "0.25 APE", ape: 0.25, qty: 1, weight: 5 },
          ],
        },
      }));
    }}
  >
    Preset: Promo Weekend
  </button>

  <button
    className="btn"
    type="button"
    onClick={() => {
      // Reset: safe defaults (points only)
      setCfg((c: any) => ({
        ...c,
        prizePools: {
          none: [{ type: "NONE", label: "Nothing this time", weight: 1, points: 0 }],
          common: [{ type: "POINTS", label: "50 REBEL", points: 50, weight: 1 }],
          rare: [{ type: "POINTS", label: "100 REBEL", points: 100, weight: 1 }],
          ultra: [{ type: "POINTS", label: "200 REBEL", points: 200, weight: 1 }],
        },
      }));
    }}
  >
    Reset Prize Pools
  </button>
</div>
          
{/* Prize Pools (JSON) */}
<div style={{ marginTop: 12 }}>
  <div style={{ fontWeight: 900, marginBottom: 8 }}>Prize Pools (JSON)</div>
  <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 10 }}>
    This is for future “NFT / APE / Merch / Nothing” prizes. (Shuffle does NOT use this yet.)
    You can safely edit these now and we’ll wire Shuffle next.
  </div>

  {(["none", "common", "rare", "ultra"] as const).map((k) => (
    <label key={k} style={{ display: "block", marginBottom: 10, fontSize: 12, opacity: 0.95 }}>
      Pool: <b>{k}</b>
      <textarea
        value={JSON.stringify((cfg as any).prizePools?.[k] ?? [], null, 2)}
        onChange={(e) => {
          try {
            const nextArr = JSON.parse(e.target.value || "[]");
            setCfg((c: any) => ({
              ...c,
              prizePools: {
                ...(c.prizePools || { none: [], common: [], rare: [], ultra: [] }),
                [k]: Array.isArray(nextArr) ? nextArr : [],
              },
            }));
          } catch {
            // ignore parse errors while typing
          }
        }}
        style={{
          width: "100%",
          minHeight: 110,
          marginTop: 6,
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,.18)",
          background: "rgba(0,0,0,.25)",
          color: "white",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
        }}
      />
    </label>
  ))}
</div>

<div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
  <button className="btn" onClick={loadConfig} style={{ padding: "10px 12px" }}>
    Load Current
  </button>
  <button className="btn" onClick={saveConfig} style={{ padding: "10px 12px" }}>
    Save
  </button>
</div>
        </div>
      </div>

      {/* Maintenance */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid rgba(255,255,255,.14)", borderRadius: 14, background: "rgba(15,23,42,.55)" }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Maintenance</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn" onClick={clearRecentWins} style={{ padding: "10px 12px" }}>
            Clear Recent Wins
          </button>
          <button className="btn" onClick={resetLeaderboards} style={{ padding: "10px 12px" }}>
            Reset Leaderboards
          </button>
          <button className="btn" onClick={resetAll} style={{ padding: "10px 12px" }}>
            Reset ALL
          </button>
          <button className="btn" onClick={() => setLog("")} style={{ padding: "10px 12px" }}>
            Clear Log
          </button>
        </div>
      </div>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid rgba(255,255,255,.14)", borderRadius: 14, background: "rgba(0,0,0,.25)", whiteSpace: "pre-wrap", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>
        {log || "Log…"}
      </div>

      <style jsx>{`
        .btn {
          padding: 8px 12px;
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
      `}</style>
    </div>
  );
}
