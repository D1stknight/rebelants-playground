// pages/grand-prix.tsx
import React from "react";
import type { NextPage } from "next";
import Head from "next/head";
import dynamic from "next/dynamic";

const RebelGP = dynamic(() => import("../components/RebelGP/RebelGP"), { ssr: false });

class GPBoundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error("Grand Prix crashed", err); }
  render() {
    if (!this.state.err) return this.props.children;
    const e = this.state.err;
    return (
      <div style={{ minHeight: "100vh", background: "#000", color: "#fff", fontFamily: "'Noto Serif JP', serif", padding: 24, textAlign: "center" }}>
        <div style={{ color: "#ff5566", letterSpacing: "0.3em", fontWeight: 800, fontSize: 13, marginTop: 40 }}>☠ REBEL GRAND PRIX CRASHED</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 14, wordBreak: "break-word" }}>{e.name}: {e.message}</div>
        <pre style={{ fontSize: 9, opacity: 0.5, marginTop: 10, whiteSpace: "pre-wrap", textAlign: "left", maxHeight: 220, overflow: "auto" }}>{String(e.stack || "").slice(0, 1500)}</pre>
        <button type="button" onClick={() => { const u = new URL(location.href); u.searchParams.set("r", String(Date.now())); location.replace(u.toString()); }} style={{ marginTop: 22, padding: "14px 26px", borderRadius: 12, border: "none", background: "#6d4ec9", color: "#fff", fontWeight: 900, letterSpacing: "0.15em", fontFamily: "inherit" }}>↻ RELOAD</button>
      </div>
    );
  }
}

const GPPage: NextPage = () => (
  <>
    <Head>
      <title>Rebel Grand Prix — Rebel Ants Playground</title>
      <meta name="description" content="SNES-style kart racing with the Rebel Ants factions. Five cups, fifteen tracks, drift, items, REBEL payouts." />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
    </Head>
    <GPBoundary><RebelGP /></GPBoundary>
  </>
);
export default GPPage;
