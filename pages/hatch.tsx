import React from "react";
import Link from "next/link";

export default function HatchPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-3">Queen's Egg Hatch</h1>
      <p className="text-slate-300 mb-6">Coming soon.</p>

      <div className="bg-slate-900/80 backdrop-blur-md border border-white/10 rounded-xl p-6">
        <div className="text-slate-200 font-semibold mb-2">🚧 Game in development</div>
        <p className="text-slate-300 mb-4">
          Hatch mechanics are being finalized. Stay tuned.
        </p>

        <div className="rounded-xl overflow-hidden border border-white/10 bg-black/20">
          <img
            src="/ui/coming-soon.png"
            alt="Coming soon"
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>

        <div className="mt-6 flex gap-3">
          <Link href="/shuffle" className="px-4 py-2 bg-blue-600 rounded-lg">
            Back to Shuffle
          </Link>
        </div>
      </div>
    </main>
  );
}
