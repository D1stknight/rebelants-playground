import React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

// ✅ Client-only (prevents localStorage/window SSR crashes)
const Shuffle = dynamic(() => import("../components/Shuffle"), { ssr: false });

export default function ShufflePage() {
  return (
    <main className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="title mb-3">Rebel Ants Playground</h1>

      <nav className="mb-6 flex items-center gap-2">
        <Link href="/tunnel" className="tab">🐜 Ant Tunnel</Link>
        <Link href="/hatch" className="tab">🥚 Queen&apos;s Egg Hatch</Link>
        <Link href="/expedition" className="tab">⚔️ The Raid</Link>
        <Link href="/shuffle" className="tab tab-active">🎴 Shuffle</Link>
      </nav>

      <section className="ant-card">
        <Shuffle />
      </section>

      <div className="mt-6">
        <Link href="/rules" className="text-slate-400 hover:underline">Official Rules</Link>
      </div>
    </main>
  );
}
