import React from 'react';
import Link from 'next/link';
import AntTunnel from '../components/AntTunnel';

export default function TunnelPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 py-6">
      {/* Top header + tabs */}
      <h1 className="title mb-3">Rebel Ants Playground</h1>
      <nav className="mb-6 flex items-center gap-2">
        <Link href="/tunnel" className="tab tab-active">Ant Tunnel</Link>
        <Link href="/hatch" className="tab">Queen&apos;s Egg Hatch</Link>
        <Link href="/expedition" className="tab">Expedition</Link>
        <Link href="/shuffle" className="tab">Shuffle</Link>
      </nav>

      {/* Card content */}
      <section className="ant-card">
        <AntTunnel />
      </section>

      <div className="mt-6">
        <Link href="/rules" className="text-slate-400 hover:underline">Official Rules</Link>
      </div>
    </main>
  );
}
