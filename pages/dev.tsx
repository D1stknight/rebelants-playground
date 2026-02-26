// pages/dev.tsx
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadProfile } from "../lib/profile";
import { pointsConfig } from "../lib/pointsConfig";

type Json = any;

const ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEV_PAGE === "true";

export default function DevToolsPage() {
  const prof = useMemo(() => loadProfile(), []);
  const defaultPid = (prof?.id || "guest").trim() || "guest";

  const [playerId, setPlayerId] = useState(defaultPid);
  const [amount, setAmount] = useState(5000);
  const [balance, setBalance] = useState<number | null>(null);
  const [earnedToday, setEarnedToday] = useState<number | null>(null);
  const [log, setLog] = useState<string>("");

  const append = (title: string, data: Json) => {
    setLog((prev) => `${prev}\n\n=== ${title} ===\n${JSON.stringify(data, null, 2)}`);
  };

  const getBalance = async () => {
    const pid = (playerId || "guest").trim() || "guest";
    const r = await fetch(`/api/points/balance?playerId=${encodeURIComponent(pid)}`);
    const j = await r.json().catch(() => null);
    append(`BALANCE (status ${r.status})`, j);
    setBalance(j?.balance ?? null);
    setEarnedToday(j?.earnedToday ?? null);
  };

  const post = async (url: string, body: any, title: string) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    append(`${title} (status ${r.status})`, j);
    await getBalance();
  };

  useEffect(() => {
    if (ENABLED) getBalance().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ENABLED]);

  if (!ENABLED) {
    return (
      <div style={{ padding: 28, color: "white" }}>
        <h1 style={{ marginBottom: 8 }}>Dev Tools</h1>
        <p style={{ opacity: 0.85, maxWidth: 720 }}>
          Dev page is disabled.
          <br />
          Set <b>NEXT_PUBLIC_ENABLE_DEV_PAGE=true</b> in Vercel Environment Variables (and optionally
          local .env.local) to enable it.
        </p>
        <p style={{ marginTop: 14 }}>
          <Link href="/" style={{ color: "white", textDecoration: "underline" }}>
            ← Back to home
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 28, color: "white", maxWidth: 980 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ margin: 0 }}>Dev Tools</h1>
        <Link href="/" style={{ color: "white", textDecoration: "underline" }}>
          Back to home
        </Link>
      </div>

      <div style={{ marginTop: 12, opacity: 0.9 }}>
        Profile loaded: <b>{prof?.name || "guest"}</b> · playerId: <b>{defaultPid}</b>
      </div>

      <div
        style={{
          marginTop: 16,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          padding: 14,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,.18)",
          background: "rgba(15,23,42,.55)",
        }}
      >
        <label style={{ fontSize: 13, opacity: 0.9 }}>
          Player ID:&nbsp;
          <input
            value={playerId}
            onChange={(e) => setPlayerId(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,.18)",
              background: "rgba(0,0,0,.25)",
              color: "white",
              minWidth: 260,
            }}
          />
        </label>

        <label style={{ fontSize: 13, opacity: 0.9 }}>
          Amount:&nbsp;
          <input
            value={amount}
            type="number"
            onChange={(e) => setAmount(parseInt(e.target.value || "0", 10))}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,.18)",
              background: "rgba(0,0,0,.25)",
              color: "white",
              width: 140,
            }}
          />
        </label>

        <button
          className="btn"
          type="button"
          onClick={getBalance}
          style={{ padding: "8px 12px", fontSize: 13 }}
        >
          Get Balance
        </button>

        <button
          className="btn"
          type="button"
          onClick={() => post("/api/points/dev-grant", { playerId, amount }, "DEV GRANT")}
          style={{ padding: "8px 12px", fontSize: 13 }}
          title="Uses /api/points/dev-grant"
        >
          Dev Grant (+{amount})
        </button>

        <button
          className="btn"
          type="button"
          onClick={() => post("/api/points/earn", { playerId, amount }, "EARN")}
          style={{ padding: "8px 12px", fontSize: 13 }}
          title="Uses /api/points/earn (daily cap may apply)"
        >
          Earn (+{amount})
        </button>

        <button
          className="btn"
          type="button"
          onClick={() => post("/api/points/spend", { playerId, amount }, "SPEND")}
          style={{ padding: "8px 12px", fontSize: 13 }}
          title="Uses /api/points/spend"
        >
          Spend (-{amount})
        </button>
      </div>

      <div style={{ marginTop: 14, opacity: 0.9 }}>
        Balance: <b>{balance ?? "—"}</b> {pointsConfig.currency} · Earned today:{" "}
        <b>{earnedToday ?? "—"}</b>
      </div>

      <div style={{ marginTop: 16 }}>
        <button
          className="btn"
          type="button"
          onClick={() => setLog("")}
          style={{ padding: "8px 12px", fontSize: 13, opacity: 0.9 }}
        >
          Clear Log
        </button>
      </div>

      <pre
        style={{
          marginTop: 10,
          padding: 14,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,.18)",
          background: "rgba(0,0,0,.25)",
          overflow: "auto",
          minHeight: 220,
          whiteSpace: "pre-wrap",
        }}
      >
        {log || "No requests yet."}
      </pre>
    </div>
  );
}
