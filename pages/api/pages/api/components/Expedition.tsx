import React, { useState } from 'react'

const crateImg: Record<'common'|'rare'|'ultra', string> = {
  common: '/crates/common.png',
  rare: '/crates/rare.png',
  ultra: '/crates/ultra.png',
}

export default function Expedition() {
  const [busy, setBusy] = useState(false)
  const [seed] = useState('guest-' + Math.random().toString(36).slice(2, 8))
  const [modal, setModal] = useState<{title?: string; rarity?: 'common'|'rare'|'ultra'; text?: string}>({})

  async function run() {
    if (busy) return
    setBusy(true)
    const bar = document.getElementById('exp-bar')
    if (bar) bar.classList.remove('bar-fill')
    await new Promise(r => setTimeout(r))
    if (bar) bar.classList.add('bar-fill')
    await new Promise(r => setTimeout(r, 5200))

    const r = await fetch('/api/expedition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed }),
    }).then(x => x.json())

    const p = r.prize
    if (p.type === 'crate') setModal({ title: p.label, rarity: p.rarity })
    else setModal({ title: p.label, text: p.type === 'none' ? 'Try again soon.' : undefined })
    setBusy(false)
  }

  return (
    <section className="mb-10">
      <h2 className="text-xl font-semibold mb-2">Colony Forage Expedition</h2>
      <p className="text-slate-400 mb-4">Send a scout on a longer run. 5-second expedition with bigger rewards.</p>

      <div className="rounded-xl border border-slate-800 p-4">
        <div className="mb-3">
          <div className="h-2 bg-slate-800 rounded overflow-hidden">
            <div id="exp-bar" className="h-2 bg-white/70 w-0"></div>
          </div>
          {busy && <div className="mt-2 text-sm text-slate-400">Marching…</div>}
        </div>
        <button disabled={busy} onClick={run} className="btn-primary">
          {busy ? 'Exploring…' : 'Start Expedition'}
        </button>
      </div>

      {modal.title && (
        <div className="modal">
          <div className="modal-card pop-in">
            <div className="text-lg font-semibold mb-1">You found:</div>
            <div className="mb-2">{modal.title}</div>
            {modal.rarity && <img src={crateImg[modal.rarity]} alt={modal.rarity} className="mx-auto w-28" />}
            <button className="btn" onClick={() => setModal({})}>Close</button>
          </div>
        </div>
      )}
    </section>
  )
}
