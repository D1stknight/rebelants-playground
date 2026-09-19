// pages/bounty.tsx
import React from "react";
import type { NextPage } from "next";
import Head from "next/head";
import dynamic from "next/dynamic";

const BountyHunters = dynamic(() => import("../components/BountyHunters/BountyHunters"), { ssr: false });

// Shows the actual error on screen (with a reload button) instead of unmounting to a blank page — needed to debug phones.
class BountyBoundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error("Bounty crashed", err); }
  render() {
    if (!this.state.err) return this.props.children;
    const e = this.state.err;
    return (
      <div style={{ minHeight: "100vh", background: "#000", color: "#fff", fontFamily: "'Noto Serif JP', serif", padding: 24, textAlign: "center" }}>
        <div style={{ color: "#ff5566", letterSpacing: "0.3em", fontWeight: 800, fontSize: 13, marginTop: 40 }}>☠ BOUNTY HUNTERS CRASHED</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 14, wordBreak: "break-word" }}>{e.name}: {e.message}</div>
        <pre style={{ fontSize: 9, opacity: 0.5, marginTop: 10, whiteSpace: "pre-wrap", textAlign: "left", maxHeight: 220, overflow: "auto" }}>{String(e.stack || "").slice(0, 1500)}</pre>
        <div style={{ fontSize: 10, opacity: 0.5, marginTop: 8 }}>{typeof navigator !== "undefined" ? navigator.userAgent : ""}</div>
        <button type="button" onClick={() => { const u = new URL(location.href); u.searchParams.set("r", String(Date.now())); location.replace(u.toString()); }} style={{ marginTop: 22, padding: "14px 26px", borderRadius: 12, border: "none", background: "#6d4ec9", color: "#fff", fontWeight: 900, letterSpacing: "0.15em", fontFamily: "inherit" }}>↻ RELOAD</button>
      </div>
    );
  }
}

const BountyPage: NextPage = () => (
  <>
    <Head>
      <title>Bounty Hunters — Rebel Ants Playground</title>
      <meta name="description" content="Run and gun through four boards of the corrupted hive. Take the boss's head, collect the bounty." />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
    </Head>
    <BountyBoundary><BountyHunters /></BountyBoundary>
  </>
);

export default BountyPage;
