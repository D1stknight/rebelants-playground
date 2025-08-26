import React, { useState } from 'react'
import PrizeModal from './PrizeModal'

type Result = { ok:boolean; prizeLabel?:string; rarity?: 'common'|'rare'|'ultra'|null }

function EggCard({ index, onPick }:{ index:number; onPick:(i:number)=>void }) {
  const [shake, setShake] = useState(false)

  function handleClick() {
    setShake(true)
    onPick(index)
    setTimeout(() => setShake(false), 700) // reset after wobble
  }

  return (
    <button
      onClick={handleClick}
      className={`egg-card group ${shake ? 'wobble' : ''}`}
    >
      <div className="egg group-hover:wobble pop-in" aria-hidden />
    </button>
  )
}
export default function Shuffle() {
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState({ open:false, label:'', sub:'' })

  async function pick(i:number) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/spin', { method:'POST' })
      const data:Result = await res.json()
      if (data.ok) {
        setModal({ open:true, label: data.prizeLabel ?? 'You found something!', sub: data.rarity ? `Rarity: ${data.rarity}` : '' })
      } else {
        setModal({ open:true, label:'Nothing this time', sub:'Try again soon.' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ant-card">
      <h2 className="title">Queen&apos;s Egg Shuffle</h2>
      <p className="subtitle mb-3">Three eggs. Pick one. Flip for a prize.</p>

      <div className="flex gap-6">
        {[0,1,2].map(i => <EggCard key={i} index={i} onPick={pick} />)}
      </div>

      <PrizeModal open={modal.open} onClose={() => setModal(m => ({...m, open:false}))} label={modal.label} sub={modal.sub} />
    </section>
  )
}
