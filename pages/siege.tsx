// pages/siege.tsx — The Siege (phase 1: solo drill). Not on the landing page yet.
import React from "react";
import type { NextPage } from "next";
import Head from "next/head";
import Link from "next/link";
import dynamic from "next/dynamic";

const SiegeView = dynamic(() => import("../components/Siege/SiegeView"), { ssr: false, loading: () => <div style={{ aspectRatio: "52 / 22", borderRadius: 16, background: "#0b0e17", border: "1px solid rgba(240,166,58,0.18)", display: "flex", alignItems: "center", justifyContent: "center", color: "#a29a88", fontFamily: "'Cinzel', Georgia, serif", letterSpacing: "0.3em", fontSize: 12 }}>RAISING THE WALLS…</div> });

const SiegePage: NextPage = () => (
  <>
    <Head>
      <title>The Siege — Rebel Ants Playground</title>
      <meta name="description" content="Hold the gate of the Ant Citadel against the spider horde. Physics catapults, toppling siege towers, beetle rams." />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
    </Head>
    <style dangerouslySetInnerHTML={{ __html: "@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&display=swap');" }} />
    <div style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 50% 0%, #1a1f30 0%, #0b0e17 60%)", color: "#e9e2d2", padding: "16px 12px 40px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, fontFamily: "'Cinzel', Georgia, serif" }}>
          <Link href="/" style={{ color: "#a29a88", textDecoration: "none", fontSize: 12, letterSpacing: "0.25em" }}>← REBEL ANTS</Link>
          <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "#f0a63a", border: "1px solid rgba(240,166,58,0.35)", borderRadius: 999, padding: "4px 12px" }}>SOLO DRILL · TESTING</div>
        </div>
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Cinzel', Georgia, serif", fontSize: "clamp(28px, 5vw, 54px)", fontWeight: 900, letterSpacing: "0.12em", color: "#ffd27a", textShadow: "0 0 40px rgba(240,166,58,0.35)", lineHeight: 1 }}>THE SIEGE</div>
          <div style={{ fontSize: 12, letterSpacing: "0.3em", color: "#a29a88", marginTop: 8, fontFamily: "'Cinzel', Georgia, serif" }}>HOLD THE GATE UNTIL THE HORN</div>
        </div>
        <SiegeView />
        <div style={{ marginTop: 14, display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", fontSize: 12, color: "#a29a88", letterSpacing: "0.05em" }}>
          <span>🎯 Move to aim, hold to charge, release</span><span>🕸 Hit tower <b style={{ color: "#e9e2d2" }}>bases</b> — they topple</span><span>🪲 Rams need several hits</span><span>⚔️ Ronin · Samurai · Warrior · Buke · Shogun man the catapult; the rest fight from the battlements</span><span>📱 Phone: turn to landscape</span>
        </div>
      </div>
    </div>
  </>
);
export default SiegePage;
