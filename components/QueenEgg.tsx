import { useEffect, useState } from 'react'
import PrizeModal from './PrizeModal'

const crateImg = { common: '/crates/common.png', rare: '/crates/rare.png', ultra: '/crates/ultra.png' }

export default function QueenEgg() {
  const [playsLeft, setPlaysLeft] = useState<number>(parseInt(process.env.NEXT_PUBLIC_DAILY_FREE_PLAYS_HATCH || process.env.DAILY_FREE_PLAYS_HATCH || '3', 10) || 3)
  const [cooldownUntil, setCooldownUntil] = useState<number>(0)
  const [modal, setModal] = useState<{open: boolean, label: string, rarity?: 'common'|'rare'|'ultra'}>({open:false, label:''})
  const [cracking, setCracking] = useState(false)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ra-hatch') || '{}')
      if (typeof saved.playsLeft === 'number') setPlaysLeft(saved.playsLeft)
      if (typeof saved.cooldownUntil === 'number') setCooldownUntil(saved.cooldownUntil)
    } catch {}
  }, [])
  useEffect(() => {
    localStorage.setItem('ra-hatch', JSON.stringify({ playsLeft, cooldownUntil }))
  }, [playsLeft, cooldownUntil])

  async function hatch() {
    if (cracking) return
    const now = Date.now()
    if (now < cooldownUntil) return
    if (playsLeft <= 0) { setModal({open:true, label:'Out of Egg Hatch plays today'}) ;return }
    setCracking(true)
    try {
      const r = await fetch('/api/hatch', { method:'POST' })
      const d = await r.json()
      if (!d.ok) setModal({open:true, label:d.error || 'Error'})
      else {
        setPlaysLeft(playsLeft-1)
        if (d.nextPlayableAt) setCooldownUntil(d.nextPlayableAt)
        setModal({open:true, label:d.prizeLabel, rarity:d.rarity})
      }
    } finally { setCracking(false) }
  }

  const cd = Math.max(0, Math.ceil((cooldownUntil - Date.now())/1000))

  return (
    <div className="ant-card">
      <div className="flex items-center gap-3 mb-4">
        <img src="/ants-logo.svg" className="h-8 w-24" alt="logo" />
        <span className="badge">Egg Hatch plays left: <b>{playsLeft}</b></span>
        <span className="badge">Cooldown: <b>{cd}s</b></span>
      </div>
      <h2 className="title">Queen's Egg Hatch</h2>
      <p className="subtitle mb-4">Crack an egg for a shot at the Queen’s crates. Jackpot vibes.</p>
      <div className="grid sm:grid-cols-[1fr_auto] gap-6">
        <div className="rounded-xl border border-slate-800 h-36 grid place-items-center text-4xl">🥚</div>
        <div className="space-y-3">
          <button className="btn w-full" onClick={hatch} disabled={cracking || Date.now() < cooldownUntil}>{cracking ? 'Cracking…' : 'Crack Egg'}</button>
        </div>
      </div>

      <PrizeModal open={modal.open} onClose={()=>setModal({...modal, open:false})} label={modal.label}>
        {modal.rarity && <img src={crateImg[modal.rarity]} alt={modal.rarity} className="mx-auto mt-4 w-32" />}
      </PrizeModal>
    </div>
  )
}
