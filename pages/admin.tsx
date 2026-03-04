// pages/admin.tsx
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Head from "next/head";
import { pointsConfig as defaultConfig } from "../lib/pointsConfig";

type PointsConfigShape = {
  currency: string;
  shuffleCost: number;
  dailyClaim: number;
  dailyEarnCap: number;
  rewards: { none: number; common: number; rare: number; ultra: number };

  ultraMinReward: number;

  // ✅ ADD THIS (decimal: 0.01 = 1%)
  rareMerchChance: number;

  // (optional) if you already added rarityWeights in "Pro Odds", keep it here too
  rarityWeights?: {
    none: number;
    common: number;
    rare: number;
    ultra: number;
  };

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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parsePercentToDecimal(input: string, fallback: number) {
  const raw = String(input || "").trim().replace("%", "");
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n / 100, 0, 1);
}

function formatDecimalAsPercent(decimal: any, fallbackPct = 0) {
  const n = Number(decimal);
  const pct = Number.isFinite(n) ? Math.round(n * 100) : fallbackPct;
  return `${pct}%`;
}

function parsePercentLike(v: any, fallback: number) {
  const s = String(v ?? "").trim();
  if (!s) return fallback;

  const cleaned = s.endsWith("%") ? s.slice(0, -1).trim() : s;
  const n = Number(cleaned);

  return Number.isFinite(n) ? n : fallback;
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);

const headers = useMemo(() => {
  return {
    "Content-Type": "application/json",
    "x-admin-key": token,
    "x-admin-token": token,
  };
}, [token]);  

  // claims
  const [claims, setClaims] = useState<any[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [claimLookupId, setClaimLookupId] = useState("");  

     // grant
  const [playerId, setPlayerId] = useState("guest");
  const [walletAddress, setWalletAddress] = useState("");
  const [amount, setAmount] = useState(5000);

  // ✅ Autocomplete (search by Discord name)
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerHits, setPlayerHits] = useState<Array<{ playerId: string; name: string }>>([]);
  const [playerSearchBusy, setPlayerSearchBusy] = useState(false);

  async function searchPlayers(q: string) {
    const s = String(q || "").trim();
    setPlayerSearch(s);

    if (s.length < 2) {
      setPlayerHits([]);
      return;
    }

    setPlayerSearchBusy(true);
    try {
      const r = await fetch(`/api/admin/players/search?q=${encodeURIComponent(s)}`, { headers });
      const j = await r.json().catch(() => null);

      if (r.ok && j?.ok && Array.isArray(j?.results)) {
        setPlayerHits(j.results);
      } else {
        setPlayerHits([]);
      }
    } catch {
      setPlayerHits([]);
    } finally {
      setPlayerSearchBusy(false);
    }
  }

  // config form
const [cfg, setCfg] = useState<PointsConfigShape>(() => ({
  currency: defaultConfig.currency,
  shuffleCost: defaultConfig.shuffleCost,
  dailyClaim: defaultConfig.dailyClaim,
  dailyEarnCap: defaultConfig.dailyEarnCap,
  rewards: { ...defaultConfig.rewards },

  ultraMinReward: Number((defaultConfig as any).ultraMinReward ?? 50),

  // ✅ ADD THIS (default 1% if missing)
  rareMerchChance: Number((defaultConfig as any).rareMerchChance ?? 0.01),

  // ✅ If you have pro odds weights, keep them too
  rarityWeights: (defaultConfig as any).rarityWeights || {
    none: 0,
    common: 0,
    rare: 0,
    ultra: 0,
  },

  prizePools: (defaultConfig as any).prizePools || {
    none: [],
    common: [],
    rare: [],
    ultra: [],
  },
}));

  const [rareMerchChancePct, setRareMerchChancePct] = useState(
  `${Math.round(((defaultConfig as any).rareMerchChance ?? 0.01) * 100)}`
);

  // =========================
  // Prize Inventory Dashboard (Merch + APE budget)
  // =========================
  const [invMerchJson, setInvMerchJson] = useState<string>(
    JSON.stringify([{ sku: "HOODIE", label: "Rebel Ants Hoodie", onHand: 10 }], null, 2)
  );
  const [invApeJson, setInvApeJson] = useState<string>(
    JSON.stringify({ dailyMaxApe: 0, usedTodayApe: 0, note: "" }, null, 2)
  );
  const [invDashBusy, setInvDashBusy] = useState(false);
  const [invDash, setInvDash] = useState<any>(null);

  async function invDashLoad() {
    if (!authed) {
      append("Inventory Dashboard: NOT AUTHORIZED (click Verify first)");
      return;
    }
    setInvDashBusy(true);
    try {
      const r = await fetch("/api/admin/inventory", { headers });
      const j = await r.json().catch(() => null);
      setInvDash(j);
      append(`INV DASH LOAD status ${r.status}\n${JSON.stringify(j, null, 2)}`);

      if (r.ok && j?.ok) {
        setInvMerchJson(JSON.stringify(j.merch ?? [], null, 2));
        setInvApeJson(JSON.stringify(j.ape ?? { dailyMaxApe: 0, usedTodayApe: 0, note: "" }, null, 2));
      }
    } finally {
      setInvDashBusy(false);
    }
  }

  async function invDashSave() {
    if (!authed) {
      append("Inventory Dashboard: NOT AUTHORIZED (click Verify first)");
      return;
    }

    let merch: any[] = [];
    let ape: any = { dailyMaxApe: 0, usedTodayApe: 0, note: "" };

    try {
      merch = JSON.parse(invMerchJson || "[]");
    } catch {
      append("INV DASH SAVE: Merch JSON is invalid");
      return;
    }

    try {
      ape = JSON.parse(invApeJson || "{}");
    } catch {
      append("INV DASH SAVE: APE JSON is invalid");
      return;
    }

    setInvDashBusy(true);
    try {
      const r = await fetch("/api/admin/inventory", {
        method: "POST",
        headers,
        body: JSON.stringify({ merch, ape }),
      });
      const j = await r.json().catch(() => null);
      setInvDash(j);
      append(`INV DASH SAVE status ${r.status}\n${JSON.stringify(j, null, 2)}`);
    } finally {
      setInvDashBusy(false);
    }
  }

  // =========================
  // Ultra NFT Inventory (Admin UI)
  // =========================
  const [invChain, setInvChain] = useState<"ETH" | "APECHAIN">("ETH");
  const [invContract, setInvContract] = useState("");
  const [invTokenIds, setInvTokenIds] = useState(""); // comma-separated
  const [invLabel, setInvLabel] = useState("NFT Prize");

    const [invBusy, setInvBusy] = useState(false);
  const [invDebug, setInvDebug] = useState<any>(null);

  // =========================
  // Admin Dashboard: Recent Wins (Win History)
  // =========================
 const [dashRecentWins, setDashRecentWins] = useState<any[]>([]);
const [dashClaims, setDashClaims] = useState<any[]>([]);
const [dashInventory, setDashInventory] = useState<any>(null);
const [dashNftInventory, setDashNftInventory] = useState<any>(null);
const [dashLoading, setDashLoading] = useState(false);

async function loadDashboard() {
  setDashLoading(true);
  append("Loading dashboard…");

  try {
    const winsReq = fetch("/api/leaderboard/summary?top=15", { cache: "no-store" });
    const claimsReq = fetch("/api/admin/claims/list", { headers });
    const merchReq = fetch("/api/admin/inventory", { headers });
    const nftReq = fetch("/api/admin/inventory/nft/debug", { headers });

    const [winsRes, claimsRes, merchRes, nftRes] = await Promise.all([
      winsReq,
      claimsReq,
      merchReq,
      nftReq,
    ]);

    const wins = await winsRes.json().catch(() => null);
    const claims = await claimsRes.json().catch(() => null);
    const merch = await merchRes.json().catch(() => null);
    const nft = await nftRes.json().catch(() => null);

    if (wins?.recentWins) setDashRecentWins(wins.recentWins);
    if (claims?.claims) setDashClaims(claims.claims);
    if (merch) setDashInventory(merch);
    if (nft) setDashNftInventory(nft);
  } catch (e: any) {
    append(`Dashboard error\n${String(e?.message || e)}`);
  } finally {
    setDashLoading(false);
  }
}

const [log, setLog] = useState<string>("");

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

  if (merged) {
    setCfg(merged);

    // ✅ keep the % input in sync with loaded config
    const pct = Math.round(Number((merged as any).rareMerchChance ?? 0.01) * 100);
    setRareMerchChancePct(String(pct));
  }
}
  
async function saveConfig() {
  append("Saving config…");

  // force percent box -> decimal (0..1) at save time
  const pct = Math.max(0, Math.min(100, Number(rareMerchChancePct || "0")));
  const payload = { ...cfg, rareMerchChance: pct / 100 };

  const r = await fetch("/api/admin/config", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const j = await r.json().catch(() => null);
  append(`SAVE CONFIG status ${r.status}\n${JSON.stringify(j, null, 2)}`);

  const merged = (j?.config ?? j?.pointsConfig) as PointsConfigShape | undefined;

  if (merged) {
    setCfg(merged);

    const pct2 = Math.round(Number((merged as any).rareMerchChance ?? 0.01) * 100);
    setRareMerchChancePct(String(pct2));
  }
}

  async function loadClaims() {
    setClaimsLoading(true);
    append("Loading claims…");

    const r = await fetch("/api/admin/claims/list", { headers });
    const j = await r.json().catch(() => null);

    append(`CLAIMS LIST status ${r.status}\n${JSON.stringify(j, null, 2)}`);

    if (r.ok && Array.isArray(j?.claims)) {
      setClaims(j.claims);
    }

    setClaimsLoading(false);
  }

   async function getClaim() {
    const id = (claimLookupId || "").trim();
    if (!id) {
      append("Get claim: missing claimId");
      return;
    }

    append(`Getting claim ${id}…`);
    const r = await fetch(`/api/admin/claims/get?claimId=${encodeURIComponent(id)}`, { headers });
    const j = await r.json().catch(() => null);

    append(`CLAIM GET status ${r.status}\n${JSON.stringify(j, null, 2)}`);

    if (r.ok && j?.claim) {
      // put it at top, de-dupe by claimId
      setClaims((prev) => {
        const next = [j.claim, ...prev.filter((c) => c?.claimId !== j.claim?.claimId)];
        return next;
      });
    }
  }

  async function unlockClaimTransferLock(id: string) {
    const claimId = String(id || "").trim();
    if (!claimId) {
      append("Unlock transfer: missing claimId");
      return;
    }

    append(`Unlocking transfer lock for ${claimId}…`);
    const r = await fetch("/api/admin/claims/unlock-transfer", {
      method: "POST",
      headers,
      body: JSON.stringify({ claimId }),
    });

    const j = await r.json().catch(() => null);
    append(`UNLOCK TRANSFER status ${r.status}\n${JSON.stringify(j, null, 2)}`);

    // refresh the row
    await fetch(`/api/admin/claims/get?claimId=${encodeURIComponent(claimId)}`, { headers })
      .then((x) => x.json())
      .then((data) => {
        if (data?.claim) {
          setClaims((prev) => {
            const next = [data.claim, ...prev.filter((c) => c?.claimId !== data.claim?.claimId)];
            return next;
          });
        }
      })
      .catch(() => null);
  }

  async function transferClaimNFT(id: string) {
    const claimId = String(id || "").trim();
    if (!claimId) {
      append("Transfer: missing claimId");
      return;
    }

    append(`Transferring NFT for ${claimId}…`);
    const r = await fetch("/api/prizes/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimId }),
    });

    const text = await r.text();
    append(`TRANSFER status ${r.status}\n${text}`);

    // refresh the row
    await fetch(`/api/admin/claims/get?claimId=${encodeURIComponent(claimId)}`, { headers })
      .then((x) => x.json())
      .then((data) => {
        if (data?.claim) {
          setClaims((prev) => {
            const next = [data.claim, ...prev.filter((c) => c?.claimId !== data.claim?.claimId)];
            return next;
          });
        }
      })
      .catch(() => null);
  }

   async function grantPoints() {
  append("Granting points…");

  const w = (walletAddress || "").trim();
  const pid = String(playerId || "guest").trim();

  const payload: any = {
    amount: Number(amount || 0),
    ...(w ? { walletAddress: w } : { playerId: pid }),
  };

  console.log("🟦 GRANT payload =", payload);
  console.log("🟦 GRANT headers =", headers);

  const r = await fetch("/api/admin/grant", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await r.text();
  console.log("🟩 GRANT status =", r.status);
  console.log("🟩 GRANT raw body =", text);

  let j: any = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {}

  append(`GRANT status ${r.status}\n${text || "(empty response)"}`);

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

    async function resetEarnedToday() {
    append("Resetting earned-today…");

    const r = await fetch("/api/admin/reset-earned", {
      method: "POST",
      headers,
      body: JSON.stringify({ playerId }),
    });

    const j = await r.json().catch(() => null);
    append(`RESET EARNED status ${r.status}\n${JSON.stringify(j, null, 2)}`);
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

  // =========================
  // Ultra NFT Inventory actions
  // =========================
  async function invRefresh() {
    if (!authed) {
      append("Inventory: NOT AUTHORIZED (click Verify first)");
      return;
    }
    setInvBusy(true);
    try {
      const r = await fetch("/api/admin/inventory/nft/debug", { headers });
      const j = await r.json().catch(() => null);
      setInvDebug(j);
      append(`INV DEBUG status ${r.status}\n${JSON.stringify(j, null, 2)}`);
    } finally {
      setInvBusy(false);
    }
  }

  async function invAdd() {
    if (!authed) {
      append("Inventory: NOT AUTHORIZED (click Verify first)");
      return;
    }

    const contract = invContract.trim();
    const label = (invLabel || "NFT Prize").trim();

    const tokenIds = invTokenIds
  .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (!contract || !contract.startsWith("0x")) {
      append("Inventory: invalid contract (must start with 0x)");
      return;
    }
    if (!tokenIds.length) {
      append("Inventory: add at least one tokenId (comma-separated)");
      return;
    }

    setInvBusy(true);
    try {
      const r = await fetch("/api/admin/inventory/nft/add", {
        method: "POST",
        headers,
        body: JSON.stringify({
          chain: invChain,
          contract,
          tokenIds,
          label,
        }),
      });
      const j = await r.json().catch(() => null);
      append(`INV ADD status ${r.status}\n${JSON.stringify(j, null, 2)}`);
      if (r.ok) {
        setInvTokenIds("");
        await invRefresh();
      }
    } finally {
      setInvBusy(false);
    }
  }

  async function invClear() {
    if (!authed) {
      append("Inventory: NOT AUTHORIZED (click Verify first)");
      return;
    }
    setInvBusy(true);
    try {
      const r = await fetch("/api/admin/inventory/nft/clear", {
        method: "POST",
        headers,
      });
      const j = await r.json().catch(() => null);
      append(`INV CLEAR status ${r.status}\n${JSON.stringify(j, null, 2)}`);
      await invRefresh();
    } finally {
      setInvBusy(false);
    }
  }

  return (
     <>
    <Head>
      <meta name="robots" content="noindex,nofollow" />
    </Head>  
       
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

      {/* Dashboard: Recent Wins */}
      <div style={{ marginTop: 14, padding: 14, border: "1px solid rgba(255,255,255,.14)", borderRadius: 14, background: "rgba(15,23,42,.55)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 900 }}>Win History (Recent Wins)</div>
          <button className="btn" onClick={loadDashboard} disabled={dashLoading} style={{ padding: "10px 12px" }}>
            {dashLoading ? "Loading…" : "Refresh Win History"}
          </button>
        </div>

        {/* System Summary */}
<div style={{
  marginTop: 12,
  display: "grid",
  gridTemplateColumns: "repeat(4,1fr)",
  gap: 10,
  fontSize: 12
}}>

<div style={{padding:10,border:"1px solid rgba(255,255,255,.1)",borderRadius:10}}>
<b>Pending Shipments</b><br/>
{dashClaims?.filter((c:any)=>String(c.status).toUpperCase()==="PENDING").length || 0}
</div>

<div style={{padding:10,border:"1px solid rgba(255,255,255,.1)",borderRadius:10}}>
<b>NFT Transfers Pending</b><br/>
{dashClaims?.filter((c:any)=>
String(c.prize?.type).toLowerCase()==="nft" &&
String(c.status).toUpperCase()==="PENDING"
).length || 0}
</div>

<div style={{padding:10,border:"1px solid rgba(255,255,255,.1)",borderRadius:10}}>
<b>Merch Inventory</b><br/>
{dashInventory?.summary?.merchOnHand ?? "—"}
</div>

<div style={{padding:10,border:"1px solid rgba(255,255,255,.1)",borderRadius:10}}>
<b>NFT Inventory</b><br/>
{dashNftInventory?.len ?? "—"}
</div>

</div>

<div style={{ marginTop: 10, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", opacity: 0.9 }}>
                <th style={{ padding: "8px 6px" }}>Time</th>
                <th style={{ padding: "8px 6px" }}>Player</th>
                <th style={{ padding: "8px 6px" }}>Rarity</th>
                <th style={{ padding: "8px 6px" }}>Prize</th>
                <th style={{ padding: "8px 6px" }}>Points</th>
              </tr>
            </thead>
            <tbody>
              {(dashRecentWins || []).map((w: any, i: number) => {
                const ts = Number(w?.ts || 0);
                const when = ts ? new Date(ts).toLocaleString() : "—";
                const name = String(w?.playerName || w?.playerId || "guest");
                const rarity = String(w?.rarity || "none");
                const prizeLabel = w?.prize?.label ? String(w.prize.label) : (w?.prize ? "Prize" : "—");
                const pts = Number(w?.pointsAwarded || 0);

                return (
                  <tr key={`${String(w?.id || i)}-${i}`} style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
                    <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>{when}</td>
                    <td style={{ padding: "8px 6px" }}>{name}</td>
                    <td style={{ padding: "8px 6px" }}>{rarity}</td>
                    <td style={{ padding: "8px 6px" }}>{prizeLabel}</td>
                    <td style={{ padding: "8px 6px" }}>{pts > 0 ? pts : "—"}</td>
                  </tr>
                );
              })}

              {(!dashRecentWins || dashRecentWins.length === 0) && (
                <tr>
                  <td colSpan={5} style={{ padding: "10px 6px", opacity: 0.8 }}>
                    No recent wins loaded yet. Click “Refresh Win History”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Claims */}
        <div style={{ padding: 14, border: "1px solid rgba(255,255,255,.14)", borderRadius: 14, background: "rgba(15,23,42,.55)" }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Claims (latest)</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn" onClick={loadClaims} style={{ padding: "10px 12px" }}>
              {claimsLoading ? "Loading…" : "Load Claims"}
            </button>

            <input
              value={claimLookupId}
              onChange={(e) => setClaimLookupId(e.target.value)}
              placeholder="claimId to lookup (optional)"
              style={{
                width: 320,
                maxWidth: "92vw",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,.18)",
                background: "rgba(0,0,0,.25)",
                color: "white",
              }}
            />

            <button className="btn" onClick={getClaim} style={{ padding: "10px 12px" }}>
              Get Claim
            </button>
          </div>

          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                           <thead>
                <tr style={{ textAlign: "left", opacity: 0.9 }}>
                  <th style={{ padding: "8px 6px" }}>Claim</th>
                  <th style={{ padding: "8px 6px" }}>Type</th>
                  <th style={{ padding: "8px 6px" }}>Label</th>
                  <th style={{ padding: "8px 6px" }}>Wallet</th>
                  <th style={{ padding: "8px 6px" }}>Status</th>
                  <th style={{ padding: "8px 6px" }}>Tx</th>
                  <th style={{ padding: "8px 6px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(claims || []).map((c) => {
                  const id = String(c?.claimId || "");
                  const type = String(c?.prize?.type || "");
                  const label = String(c?.prize?.label || "");
                  const wallet = String(c?.wallet || "");
                  const status = String(c?.status || "");
                  const tx = String(c?.txHash || "");

       const statusColor =
  status.toUpperCase() === "FULFILLED"
    ? "#4ade80"
    : status.toUpperCase() === "PENDING"
    ? "#facc15"
    : "white";
                  const short = (s: string, n = 8) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

                  const isNft = type.toLowerCase() === "nft";
                  const isPending = status.toUpperCase() === "PENDING";

                  return (
                    <tr key={id} style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
                      <td style={{ padding: "8px 6px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{short(id, 14)}</td>
                      <td style={{ padding: "8px 6px" }}>{type}</td>
                      <td style={{ padding: "8px 6px" }}>{label}</td>
                      <td style={{ padding: "8px 6px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{short(wallet, 12)}</td>
                      <td style={{ padding: "8px 6px", color: statusColor }}>
  {status}
</td>
                      <td style={{ padding: "8px 6px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{short(tx, 12)}</td>

   <td style={{ padding: "8px 6px" }}>
  {isNft && isPending ? (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button
        className="btn"
        onClick={() => unlockClaimTransferLock(id)}
        style={{ padding: "6px 10px", fontSize: 12 }}
      >
        Unlock
      </button>

      <button
        className="btn"
        onClick={() => transferClaimNFT(id)}
        style={{ padding: "6px 10px", fontSize: 12 }}
      >
        Transfer
      </button>
    </div>
  ) : String(type).toLowerCase() === "merch" &&
    (String(status).toUpperCase() === "READY_TO_FULFILL" ||
      String(status).toUpperCase() === "PENDING" ||
      String(status).toUpperCase() === "NEEDS_SHIPPING") ? (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button
        className="btn"
        onClick={async () => {
          append(`Fulfilling merch claim ${id}…`);
          const r = await fetch("/api/admin/claims/fulfill", {
            method: "POST",
            headers,
            body: JSON.stringify({ claimId: id }),
          });
          const j = await r.json().catch(() => null);
          append(`FULFILL status ${r.status}\n${JSON.stringify(j, null, 2)}`);
          await loadClaims();
        }}
        style={{ padding: "6px 10px", fontSize: 12 }}
      >
        Mark Fulfilled
      </button>

      <button
        className="btn"
        onClick={() => {
          setClaimLookupId(id);
          getClaim();
        }}
        style={{ padding: "6px 10px", fontSize: 12 }}
      >
        View
      </button>
    </div>
  ) : (
    <span style={{ opacity: 0.7, fontSize: 12 }}>—</span>
  )}
</td>
                    </tr>
                  );
                })}
                {(!claims || claims.length === 0) && (
                  <tr>
                    <td colSpan={7} style={{ padding: "10px 6px", opacity: 0.8 }}>
                      No claims loaded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>        
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
                       <div style={{ position: "relative", width: 360, maxWidth: "92vw" }}>
              <input
                value={playerSearch}
                onChange={(e) => searchPlayers(e.target.value)}
                placeholder="Search player (Discord name)…"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,.18)",
                  background: "rgba(0,0,0,.25)",
                  color: "white",
                }}
              />

              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
                Selected PlayerId:{" "}
                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                  {playerId}
                </span>
                {playerSearchBusy ? <span> • searching…</span> : null}
              </div>

              {playerHits.length > 0 ? (
                <div
                  style={{
                    position: "absolute",
                    top: 44,
                    left: 0,
                    right: 0,
                    zIndex: 50,
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,.18)",
                    background: "rgba(15,23,42,.98)",
                    overflow: "hidden",
                  }}
                >
                  {playerHits.map((hit) => (
                    <button
                      key={hit.playerId}
                      type="button"
                      className="btn"
                      onClick={() => {
                        setPlayerId(hit.playerId);      // ✅ this is what Grant uses
                        setPlayerHits([]);              // close dropdown
                        setPlayerSearch(hit.name);      // keep it pretty
                        setWalletAddress("");           // avoid confusion (optional)
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        borderRadius: 0,
                        border: "none",
                        borderBottom: "1px solid rgba(255,255,255,.08)",
                        background: "transparent",
                        color: "white",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      <div>{hit.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.85, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                        {hit.playerId}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

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

            <button
  className="btn"
  onClick={() => {
    console.log("✅ GRANT BUTTON CLICKED");
    grantPoints();
  }}
  style={{ padding: "10px 12px" }}
>
  Grant (wallet if provided)
</button>
            <button className="btn" onClick={resetEarnedToday} style={{ padding: "10px 12px" }}>
              Reset Earned Today
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

<div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,.12)" }}>
  <div style={{ fontWeight: 900, marginBottom: 10 }}>Pro Odds</div>

  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
    {(["ultra", "rare", "common", "none"] as const).map((k) => (
      <label key={k} style={{ fontSize: 12, opacity: 0.9 }}>
        Rarity Weight {k} (ex: 50%)
        <input
          value={`${(cfg.rarityWeights as any)?.[k] ?? 0}%`}
          onChange={(e) =>
            setCfg((c) => ({
              ...c,
              rarityWeights: {
                ...(c.rarityWeights || { none: 45, common: 37, rare: 15, ultra: 3 }),
                [k]: parsePercentLike(e.target.value, Number((c.rarityWeights as any)?.[k] ?? 0)),
              },
            }))
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

   <label style={{ fontSize: 12, opacity: 0.9 }}>
  Rare → Merch chance (ex: 10%)
  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
    <input
      value={rareMerchChancePct}
      onChange={(e) => {
        const v = String(e.target.value || "").replace(/[^\d]/g, ""); // digits only
        const pct = Math.max(0, Math.min(100, Number(v || 0))); // clamp 0-100
        setRareMerchChancePct(String(pct));

        // ✅ update cfg immediately (NO blur needed)
        setCfg((c: any) => ({
          ...c,
          rareMerchChance: pct / 100,
        }));
      }}
      placeholder="10"
      style={{
        width: 120,
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,.18)",
        background: "rgba(0,0,0,.25)",
        color: "white",
      }}
    />
    <span style={{ opacity: 0.9, fontWeight: 800 }}>%</span>
  </div>
</label>
  </div>

  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
    These are <b>weights</b>. They do NOT need to add to 100. Higher = more likely.
  </div>
</div>
          
         {/* Economy Presets (affects real gameplay) */}
<div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
  <button
    className="btn"
    type="button"
    onClick={() => {
      // House Edge: more NONE, smaller points, rare merch low, ultra still pays points (NFTs only if you add them)
      setCfg((c: any) => ({
        ...c,

        // ✅ real game knobs
        rarityWeights: { none: 55, common: 33, rare: 10, ultra: 2 },
        rewards: { none: 0, common: 50, rare: 100, ultra: 300 },
        rareMerchChance: 0.01, // 1%

        // ✅ pools only matter for rare merch + ultra NFTs (points here won't drive payouts)
        prizePools: {
          ...(c.prizePools || {}),
          none: [{ type: "NONE", label: "Nothing this time", points: 0 }],
          common: [{ type: "POINTS", label: "50 REBEL", points: 50 }], // harmless
          rare: [
            { type: "MERCH", label: "Sticker Pack", sku: "STICKERS", qty: 10, weight: 1 },
          ],
          ultra: [
            // put NFTs here when ready; Ultra points are driven by rewards.ultra
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
      // Promo Weekend: better odds, bigger points, higher rare merch chance
      setCfg((c: any) => ({
        ...c,

        // ✅ real game knobs
        rarityWeights: { none: 35, common: 40, rare: 20, ultra: 5 },
        rewards: { none: 0, common: 75, rare: 150, ultra: 500 },
        rareMerchChance: 0.05, // 5%

        // ✅ pools only matter for rare merch + ultra NFTs
        prizePools: {
          ...(c.prizePools || {}),
          none: [{ type: "NONE", label: "Nothing this time", points: 0 }],
          common: [{ type: "POINTS", label: "75 REBEL", points: 75 }], // harmless
          rare: [
            { type: "MERCH", label: "Hat", sku: "HAT", qty: 3, weight: 1 },
          ],
          ultra: [
            // put NFTs here when ready; Ultra points are driven by rewards.ultra
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
      // Reset: safe defaults (points-driven)
      setCfg((c: any) => ({
        ...c,
        rarityWeights: { none: 45, common: 37, rare: 15, ultra: 3 },
        rewards: { none: 0, common: 50, rare: 100, ultra: 200 },
        rareMerchChance: 0.01,
        prizePools: {
          ...(c.prizePools || {}),
          none: [{ type: "NONE", label: "Nothing this time", points: 0 }],
          common: [{ type: "POINTS", label: "50 REBEL", points: 50 }],
          rare: [{ type: "POINTS", label: "100 REBEL", points: 100 }],
          ultra: [{ type: "POINTS", label: "200 REBEL", points: 200 }],
        },
      }));
    }}
  >
    Reset Economy
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

          {/* Prize Inventory Dashboard */}
      <div
        style={{
          marginTop: 14,
          padding: 14,
          border: "1px solid rgba(255,255,255,.14)",
          borderRadius: 14,
          background: "rgba(15,23,42,.55)",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Prize Inventory Dashboard</div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn" onClick={invDashLoad} disabled={invDashBusy} style={{ padding: "10px 12px" }}>
            Load Inventory
          </button>
          <button className="btn" onClick={invDashSave} disabled={invDashBusy} style={{ padding: "10px 12px" }}>
            Save Inventory
          </button>

          <span style={{ fontSize: 12, opacity: 0.85 }}>
            Merch key: <b>ra:inv:merch_v1</b> • APE key: <b>ra:inv:ape_v1</b>
          </span>
        </div>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 900, marginBottom: 8, fontSize: 12, opacity: 0.95 }}>Merch Inventory (JSON)</div>
            <textarea
              value={invMerchJson}
              onChange={(e) => setInvMerchJson(e.target.value)}
              style={{
                width: "100%",
                minHeight: 170,
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,.18)",
                background: "rgba(0,0,0,.25)",
                color: "white",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 12,
              }}
            />
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
              Format: <code>[{"{"}"sku":"HOODIE","label":"Rebel Ants Hoodie","onHand":10{"}"}]</code>
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 900, marginBottom: 8, fontSize: 12, opacity: 0.95 }}>APE Budget (JSON)</div>
            <textarea
              value={invApeJson}
              onChange={(e) => setInvApeJson(e.target.value)}
              style={{
                width: "100%",
                minHeight: 170,
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,.18)",
                background: "rgba(0,0,0,.25)",
                color: "white",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 12,
              }}
            />
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
              Format: <code>{"{"}"dailyMaxApe":1,"usedTodayApe":0,"note":"optional"{"}"}</code>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
          Summary:{" "}
          <b>
            {typeof invDash?.summary?.merchSkus === "number" ? invDash.summary.merchSkus : "—"}
          </b>{" "}
          SKUs •{" "}
          <b>
            {typeof invDash?.summary?.merchOnHand === "number" ? invDash.summary.merchOnHand : "—"}
          </b>{" "}
          total on-hand
        </div>
      </div>

      {/* Inventory */}
      <div
        style={{
          marginTop: 14,
          padding: 14,
          border: "1px solid rgba(255,255,255,.14)",
          borderRadius: 14,
          background: "rgba(15,23,42,.55)",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Ultra NFT Inventory</div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 12, opacity: 0.9 }}>
            Chain
            <select
              value={invChain}
              onChange={(e) => setInvChain((e.target.value || "ETH") as any)}
              style={{
                display: "block",
                marginTop: 6,
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,.18)",
                background: "rgba(0,0,0,.25)",
                color: "white",
              }}
            >
              <option value="ETH">ETH</option>
              <option value="APECHAIN">APECHAIN</option>
            </select>
          </label>

          <label style={{ fontSize: 12, opacity: 0.9, minWidth: 420, maxWidth: "92vw" }}>
            Contract
            <input
              value={invContract}
              onChange={(e) => setInvContract(e.target.value)}
              placeholder="0x…"
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

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 12, opacity: 0.9, minWidth: 420, maxWidth: "92vw" }}>
            Token IDs (comma-separated)
            <input
              value={invTokenIds}
              onChange={(e) => setInvTokenIds(e.target.value)}
              placeholder="935,936,937"
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

          <label style={{ fontSize: 12, opacity: 0.9, minWidth: 260 }}>
            Label
            <input
              value={invLabel}
              onChange={(e) => setInvLabel(e.target.value)}
              placeholder="Rebel Ant #935"
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

          <button className="btn" onClick={invAdd} disabled={invBusy} style={{ padding: "10px 12px" }}>
            Add
          </button>
          <button className="btn" onClick={invRefresh} disabled={invBusy} style={{ padding: "10px 12px" }}>
            Refresh
          </button>
          <button className="btn" onClick={invClear} disabled={invBusy} style={{ padding: "10px 12px" }}>
            Clear
          </button>

          <span style={{ fontSize: 12, opacity: 0.85 }}>
            (Uses key: <b>ra:inv:ultra:nft</b>)
          </span>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
          Current length: <b>{typeof invDebug?.len === "number" ? invDebug.len : "—"}</b>
        </div>

        <div
          style={{
            marginTop: 10,
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,.14)",
            background: "rgba(0,0,0,.25)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          {invDebug ? JSON.stringify(invDebug, null, 2) : "Inventory debug… (click Refresh)"}
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
  </>
  );
}
