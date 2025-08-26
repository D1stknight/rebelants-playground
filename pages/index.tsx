// pages/index.tsx
import { useState } from 'react'
import Head from 'next/head'
import AntTunnel from '../components/AntTunnel'
import QueenEgg from '../components/QueenEgg'
import Expedition3D from '../components/Expedition3D'

export default function Home() {
  const [tab, setTab] = useState<'tunnel' | 'hatch' | 'expedition' | 'shuffle'>('tunnel')
  return (
    <main className="max-w-5xl mx-auto p-6">
      <Head><title>Rebel Ants Playground</title></Head>

      <header className="mb-6">
        <h1 className="title">Rebel Ants Playground</h1>
        <p className="subtitle">Daily mini-games. Win $REBEL and loot crates.</p>
      </header>

      <div className="flex gap-2 mb-4">
        <button className={'tab ' + (tab === 'tunnel' ? 'tab-active' : '')} onClick={() => setTab('tunnel')}>🐜 Ant Tunnel</button>
        <button className={'tab ' + (tab === 'hatch' ? 'tab-active' : '')} onClick={() => setTab('hatch')}>🥚 Queen&apos;s Egg Hatch</button>
        <button className={'tab ' + (tab === 'expedition' ? 'tab-active' : '')} onClick={() => setTab('expedition')}>🗡️ Expedition</button>
        <button className={'tab ' + (tab === 'shuffle' ? 'tab-active' : '')} onClick={() => setTab('shuffle')}>🥚 Shuffle</button>
      </div>

      {tab === 'tunnel' ? <AntTunnel /> :
       tab === 'hatch' ? <QueenEgg /> :
       tab === 'expedition' ? <Expedition3D /> :
       <QueenEgg variant="shuffle" />}

      <footer className="mt-8 text-sm text-slate-500">
        <a className="underline" href="/rules">Official Rules</a>
      </footer>
    </main>
  )
}
