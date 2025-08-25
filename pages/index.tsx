import { useState } from 'react'
import Head from 'next/head'
import AntTunnel from '../components/AntTunnel'
import QueenEgg from '../components/QueenEgg'

export default function Home() {
  const [tab, setTab] = useState<'tunnel'|'hatch'>('tunnel')
  return (
    <main className="max-w-5xl mx-auto p-6">
      <Head><title>Rebel Ants Playground</title></Head>
      <header className="mb-6">
        <h1 className="title">Rebel Ants Playground</h1>
        <p className="subtitle">Daily mini-games. Win $REBEL and loot crates.</p>
      </header>
      <div className="flex gap-2 mb-4">
        <button className={"tab " + (tab==='tunnel' ? 'tab-active' : '')} onClick={()=>setTab('tunnel')}>🐜 Ant Tunnel</button>
        <button className={"tab " + (tab==='hatch' ? 'tab-active' : '')} onClick={()=>setTab('hatch')}>🥚 Queen's Egg Hatch</button>
      </div>
      {tab === 'tunnel' ? <AntTunnel /> : <QueenEgg />}
      <footer className="mt-8 text-sm text-slate-500">
        <a className="underline" href="/rules">Official Rules</a>
      </footer>
    </main>
  )
}
