import React from "react";
import Link from "next/link";
import Head from "next/head";

export default function HatchPage() {
  return (
    <>
      <Head>
        <title>Queen's Egg Hatch — Rebel Ants Playground</title>
      </Head>
      <div style={{ minHeight: "100vh", background: "#0a0d16", color: "white" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 20px" }}>
          <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 12 }}>
            <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>Rebel Ants Playground</Link>
          </div>
          <nav className="tabs" aria-label="Main" style={{ marginBottom: 28 }}>
            <Link href="/tunnel"     className="tab">🐜 Ant Tunnel</Link>
            <Link href="/hatch"      className="tab tab-active">🥚 Queen&apos;s Egg Hatch</Link>
            <Link href="/expedition" className="tab">⚔️ The Raid</Link>
            <Link href="/shuffle"    className="tab">🃏 Shuffle</Link>
          </nav>

          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 32 }}>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Queen's Egg Hatch</div>
            <p style={{ opacity: 0.7, marginBottom: 20 }}>Coming soon.</p>

            <div style={{ fontWeight: 600, marginBottom: 8, opacity: 0.9 }}>🚧 Game in development</div>
            <p style={{ opacity: 0.7, marginBottom: 20 }}>
              Hatch mechanics are being finalized. Stay tuned.
            </p>

            <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.2)" }}>
              <img src="/ui/coming-soon.png" alt="Coming soon" style={{ width: "100%", height: "auto", display: "block" }} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
