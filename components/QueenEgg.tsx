import React, { useState } from 'react'
import PrizeModal from './PrizeModal'

type Result = { ok:boolean; prizeLabel?:string; rarity?: 'common'|'rare'|'ultra'|null }

export default function QueenEgg() {
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState({ open:false, label:'', sub:'' })

  async function crack() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/hatch', { method:'POST' })
      const data:Result = await res.json()
      if (data.ok) {
        setModal({ open:true, label: data.prizeLabel ?? 'You found something!', sub: data.rarity ? `Rarity: ${data.rarity}` : '' })
      } else {
        setModal({ open:true, label:'Nothing this time', sub:'The Queen says try again.' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ant-card">
      <h2 className="title">Queen&apos;s Egg Hatch</h2>
      <p className="subtitle mb-3">Crack an egg for a shot at the Queen&apos;s crates. Jackpot vibes.</p>

      <div className="flex items-center gap-4">
        <div className="egg" aria-hidden />
        <button onClick={crack} className="btn" disabled={busy}>{busy ? 'Cracking…' : 'Crack Egg'}</button>
      </div>

      <PrizeModal open={modal.open} onClose={() => setModal(m => ({...m, open:false}))} label={modal.label} sub={modal.sub} />
    </section>
  )
}
