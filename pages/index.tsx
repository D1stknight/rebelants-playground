// pages/index.tsx
import Head from 'next/head';
import React, { useState } from 'react';
import AntTunnel from '../components/AntTunnel';
import QueenEgg from '../components/QueenEgg';
import Expedition from '../components/Expedition';

type Tab = 'tunnel'|'hatch'|'expedition'|'shuffle';

export default function Home() {
  const [tab, setTab] = useState<Tab>('tunnel');

  return (
    <main className="max-w-5xl mx-auto p-6">
      <Head>
        <title>Rebel Ants Playground</title>
      </Head>

      <header className="mb-6">
        <h1 className="title">Rebel Ants Playground</h1>
        <p className="subtitle">Daily mini-games. Win $REBEL and loot crates.</p>
      </header>

      <div className="flex gap-2 mb-4">
        <button className={`tab ${tab==='tunnel'?'tab-active':''}`} onClick={()=>setTab('tunnel')}>🐜 Ant Tunnel</button>
        <button className={`tab ${tab==='hatch'?'tab-active':''}`} onClick={()=>setTab('hatch')}>🥚 Queen&apos;s Egg Hatch</button>
        <button className={`tab ${tab==='expedition'?'tab-active':''}`} onClick={()=>setTab('expedition')}>🛡️ Expedition</button>
        <button className={`tab ${tab==='shuffle'?'tab-active':''}`} onClick={()=>setTab('shuffle')}>🥚 Shuffle</button>
      </div>

      {tab==='tunnel' && <AntTunnel />}
      {tab==='hatch' && <QueenEgg variant="hatch" />}
      {tab==='expedition' && <Expedition />}
      {tab==='shuffle' && <QueenEgg variant="shuffle" />}

      <footer className="mt-10 text-sm text-slate-500">
        <a className="underline" href="/rules">Official Rules</a>
      </footer>
    </main>
  );
}
