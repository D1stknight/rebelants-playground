import React, { useState } from 'react'
import PrizeModal from './PrizeModal'

type Result = { ok:boolean; prizeLabel?:string; rarity?: 'common'|'rare'|'ultra'|null; error?:string }

export default function AntTunnel() {
  const [seed] = useState(() => 'guest-' + Math.random().toString(36).slice(2,8))
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState({ open:false, label:'', sub:'' })

  async function run() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/tunnel', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ seed }) })
      const data:Result = await res.json()
      if (!data.ok) {
        setModal({ open:true, label:'Nothing this time', sub:'Try again tomorrow.' })
      } else {
        const label = data.prizeLabel || 'Nothing this time'
        const sub = data.rarity ? `Rarity: ${data.rarity}` : undefined
        setModal({ open:true, label, sub: sub || '' })
      }
    } catch {
      setModal({ open:true, label:'Error', sub:'Please try again later.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ant-card">
      <h2 className="title">Ant Tunnel Forage</h2>
      <p className="subtitle mb-3">Daily $REBEL forage — steady rewards.</p>

      <div className="relative">
        <div className="ant-scout" aria-hidden />
        <div className="mt-3 flex items-center gap-2">
          <input className="w-full bg-slate-900/40 border border-slate-700 rounded px-3 py-2" value={seed} readOnly />
          <button onClick={run} className="btn" disabled={busy}>{busy?'Working…':'Send Scout'}</button>
        </div>
      </div>

      <PrizeModal open={modal.open} onClose={() => setModal(m => ({...m, open:false}))} label={modal.label} sub={modal.sub} />
    </section>
  )
}
