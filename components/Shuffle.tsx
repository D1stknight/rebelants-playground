import React, { useState } from 'react'

const crateImg: Record<'common'|'rare'|'ultra', string> = {
  common: '/crates/common.png',
  rare: '/crates/rare.png',
  ultra: '/crates/ultra.png',
}

export default function Shuffle() {
  const [seed] = useState('guest-' + Math.random().toString(36).slice(2,7))
  const [busy, setBusy] = useState(false)
  const [choice, setChoice] = useState<number | null>(null)
  const [modal, setModal] = useState<{title?: string; rarity?: 'common'|'rare'|'ultra'}>({})

  async function pick(i: number) {
    if (busy) return
    setBusy(true)
    setChoice(i)
    await new Promise(r => setTimeout(r, 500))
    const r = await fetch('/api/shuffle', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ seed, pick: i })
    }).then(x => x.json())
    const p = r.prize
    if (p.type === 'crate') setModal({ title: p.label, rarity: p.rarity })
    else setModal({ title: p.label })
    setBusy(false)
  }

  return (
    <section>
      <h2 className="text-xl font-semibold mb-2">Queen’s Egg Shuffle</h2>
      <p className="text-slate-400 mb-4">Three eggs. Pick one. Flip for a prize.</p>

      <div className="flex gap-6 items-center">
        {[0,1,2].map(i => (
          <button key={i} disabled={busy} onClick={() => pick(i)}
            className={"h-24 w-20 grid place-items-center rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 transition " +
                       (choice===i && busy ? "wobble" : "")}>
            🥚
          </button>
        ))}
      </div>

      {modal.title && (
        <div className="modal">
          <div className="modal-card pop-in">
            <div className="text-lg font-semibold mb-1">You found:</div>
            <div className="mb-2">{modal.title}</div>
            {modal.rarity && <img src={crateImg[modal.rarity]} alt={modal.rarity} className="mx-auto w-28" />}
            <button className="btn" onClick={() => { setModal({}); setChoice(null); }}>Close</button>
          </div>
        </div>
      )}
    </section>
  )
}
