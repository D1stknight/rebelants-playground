import Link from "next/link";
import React from "react";

export default function TunnelRulesPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, rgba(96,165,250,0.08), rgba(2,6,23,0.98) 45%)",
        color: "white",
        padding: "40px 16px",
      }}
    >
      <div
        style={{
          maxWidth: 980,
          margin: "0 auto",
        }}
      >
        <Link
          href="/tunnel"
          style={{
            color: "#dbeafe",
            textDecoration: "underline",
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          ← Back to Tunnel
        </Link>

        <h1
          style={{
            fontSize: 44,
            lineHeight: 1.05,
            marginTop: 18,
            marginBottom: 20,
            fontWeight: 900,
          }}
        >
          Ant Tunnel — How to Play + Official Rules
        </h1>

        <div
          style={{
            borderRadius: 22,
            border: "1px solid rgba(96,165,250,0.18)",
            background: "rgba(9,12,22,0.92)",
            boxShadow:
              "0 0 0 1px rgba(96,165,250,0.10), 0 0 24px rgba(96,165,250,0.08), 0 18px 40px rgba(0,0,0,0.32)",
            padding: 22,
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <div
            style={{
              padding: 16,
              borderRadius: 16,
              background:
                "linear-gradient(135deg, rgba(96,165,250,0.10), rgba(244,63,94,0.08))",
              border: "1px solid rgba(255,255,255,0.08)",
              fontSize: 16,
              lineHeight: 1.65,
              fontWeight: 700,
              color: "#e5e7eb",
            }}
          >
            Move with purpose. Break what stands in your way. In the dark, hesitation is defeat.
          </div>

          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Enter the Tunnel</h2>
            <p style={paragraphStyle}>
              Ant Tunnel is a skill-based challenge where every run is shaped by your movement,
              timing, pathing, and decision-making. Your objective is simple: move through the
              tunnel, collect crystals, avoid danger, and post the strongest run you can.
            </p>
            <p style={paragraphStyle}>
              There is no luck in the tunnel. Only instinct, control, and survival.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>How to Play</h2>
            <ul style={listStyle}>
              <li>Use the arrow keys to move your ant through the tunnel</li>
              <li>Press Space to break a wall directly in front of you</li>
              <li>Collect crumbs, sugar, and crystals to build your score</li>
              <li>Avoid spiders and keep moving under pressure</li>
              <li>Finish your run with the highest score possible</li>
            </ul>
          </section>

          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Scoring</h2>
            <ul style={listStyle}>
              <li>Crumbs add light value to your run</li>
              <li>Sugar adds more value</li>
              <li>Crystals carry the highest value</li>
              <li>Efficient movement and smart route choices improve your final result</li>
            </ul>
          </section>

          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Full Clear</h2>
            <p style={paragraphStyle}>
              A Full Clear happens when all crystals in a run are collected. Full Clears qualify
              for the Fastest Clear Tunnel leaderboard.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Leaderboards</h2>
            <ul style={listStyle}>
              <li>Top Score tracks the highest score achieved in a single Tunnel run</li>
              <li>Fastest Clear tracks the fastest completed Full Clear run</li>
              <li>These leaderboards are based on Ant Tunnel performance only</li>
            </ul>
          </section>

          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Fair Play</h2>
            <p style={paragraphStyle}>
              Use of exploits, automation, unintended mechanics, or any method that interferes
              with normal gameplay may result in score removal, stat resets, or leaderboard
              disqualification.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Important Notice</h2>
            <p style={paragraphStyle}>
              Ant Tunnel is a skill-based interactive game experience. Outcomes are determined by
              player input and gameplay decisions. No outcome is determined by chance, and no
              wager is placed to participate.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Live Updates</h2>
            <p style={paragraphStyle}>
              Visuals, enemy behavior, scoring balance, pickups, and leaderboard systems may be
              refined over time as the Rebel Ants Playground expands. The colony is always adapting.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

const sectionStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 16,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 900,
  margin: "0 0 10px 0",
};

const paragraphStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  lineHeight: 1.75,
  opacity: 0.92,
};

const listStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 20,
  fontSize: 15,
  lineHeight: 1.9,
  opacity: 0.92,
};
