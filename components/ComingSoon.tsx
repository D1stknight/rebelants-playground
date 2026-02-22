// components/ComingSoon.tsx
import React from "react";
import Link from "next/link";

export default function ComingSoon({
  title,
  subtitle,
  backHref = "/shuffle",
  backLabel = "Back to Shuffle",
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="title mb-2">{title}</h1>
      <p className="text-slate-300 mb-6">{subtitle ?? "Coming soon."}</p>

      <section className="ant-card overflow-hidden">
        <div className="p-4">
          <div className="text-sm text-slate-300 mb-3">🚧 Game in development</div>

          <div className="rounded-xl overflow-hidden border border-white/10 bg-black/20">
            <img
              src="/ui/coming-soon.png"
              alt="Coming Soon"
              style={{ width: "100%", height: "auto", display: "block" }}
            />
          </div>

          <div className="mt-4">
            <Link href={backHref} className="btn">
              {backLabel}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
