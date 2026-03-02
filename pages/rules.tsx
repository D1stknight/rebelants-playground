// pages/rules.tsx
import Link from "next/link";

export default function Rules() {
  return (
    <main className="max-w-3xl mx-auto p-6">
      <Link
        href="/shuffle"
        style={{
          textDecoration: "underline",
          display: "inline-block",
          marginBottom: 12,
          opacity: 0.9,
        }}
      >
        ← Back to Shuffle
      </Link>

      <h1 className="title mb-4">Official Rules</h1>

      <div className="ant-card space-y-4 text-sm leading-6">
        <p>
          <b>Free-to-play.</b> No purchase necessary to play. Void where prohibited.
        </p>

        <p>
          <b>Game currency:</b> REBEL Points are an in-app, promotional points system used inside Rebel Ants Playground.
          REBEL Points have no guaranteed cash value and are not redeemable for cash.
        </p>

        <p>
          <b>Optional purchase (APE):</b> You may optionally buy REBEL Points using APE. Purchases are used to support
          the project (including operating costs and profit). <b>All purchases are final</b> (no refunds).
          Network fees (gas) may apply.
        </p>

        <p>
          <b>Prizes:</b> Crates may award REBEL Points and/or digital collectibles and/or merch (when available).
          Prize availability may vary by location. Where required, equivalent alternatives may be offered.
        </p>

        <p>
          <b>Daily limits:</b> Daily claim and daily earn caps apply to prevent abuse. If a cap is reached,
          rewards may be reduced or not credited until the next day.
        </p>

        <p>
          <b>Fair play:</b> Multi-accounting, automation/bots, exploits, or abuse may result in disqualification,
          prize forfeiture, or account blocking.
        </p>

        <p>
          <b>Odds:</b> Prize odds and point values may change over time based on live configuration and promotions.
        </p>

        <p>
          <b>Taxes:</b> You are responsible for any taxes associated with prizes, if applicable.
        </p>

        <p style={{ opacity: 0.85 }}>
          By playing, you agree to these rules and acknowledge that this is an entertainment experience with promotional rewards.
        </p>
      </div>
    </main>
  );
}
