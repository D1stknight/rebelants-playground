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

      <h1 className="title mb-4">Official Rules (MVP)</h1>

      <div className="ant-card space-y-4 text-sm leading-6">
        <p>Free-to-play promotional mini-games. No purchase necessary. Void where prohibited.</p>
        <p>Prizes are community points ($REBEL) and digital collectibles. No cash/crypto payouts in the US.</p>
        <p>No cash/crypto payouts in the US.</p>
        <p>Abuse (multi-accounting, automation) may result in disqualification.</p>
      </div>
    </main>
  );
}
