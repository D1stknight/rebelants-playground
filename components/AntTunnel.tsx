import React, { useState } from 'react'

type PrizeDetail =
  | { title: string; type: 'crate'; rarity: 'common' | 'rare' | 'ultra'; label?: string }
  | { title: string; type: 'none' }

export default function AntTunnel() {
  const [seed, setSeed] = useState('guest-' + Math.random().toString(36).slice(2, 8))
  const [busy, setBusy] = useState(false)

  async function sendScout() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed }),
      })
      const data: any = await res.json()

      let detail: PrizeDetail
      if (data?.type === 'crate' && data?.rarity) {
        detail = { title: 'You found:', type: 'crate', rarity: data.rarity, label: data.label }
      } else {
        detail = { title: 'You found:', type: 'none' }
      }

      // Tell the global PrizeModalHost to open
      window.dispatchEvent(new CustomEvent<PrizeDetail>('rebelants:prize', { detail }))
    } catch {
      window.dispatchEvent(
        new CustomEvent<PrizeDetail>('rebelants:prize', {
          detail: { title: 'You found:', type: 'none' },
        }),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ant-card">
      <h2 className="title mb-2">Ant Tunnel Forage</h2>
      <p className="subtitle mb-4">Daily $REBEL forage — steady rewards.</p>

      <div className="flex items-center gap-3">
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          className="px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-slate-100 w-64"
          placeholder="your-seed"
        />
        <button className="btn btn-primary" onClick={sendScout} disabled={busy}>
          {busy ? 'Scouting…' : 'Send Scout'}
        </button>
      </div>
    </section>
  )
}
