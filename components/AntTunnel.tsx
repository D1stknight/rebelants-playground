import { useEffect, useState } from 'react'
import PrizeModal from './PrizeModal'

export default function AntTunnel() {
  const [userSeed, setUserSeed] = useState('guest-' + Math.random().toString(36).slice(2))
  const [playsLeft, setPlaysLeft] = useState<number>(parseInt(process.env.NEXT_PUBLIC_DAILY_FREE_PLAYS_TUNNEL || process.env.DAILY_FREE_PLAYS_TUNNEL || '3', 10) || 3)
  const [cooldownUntil, setCooldownUntil] = useState<number>(0)
  const [spinning, setSpinning] = useState(false)
  const [modal, setModal] = useState<{open: boolean, label: string, sub?: string, img?: string}>({open:false, label:''})

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ra-tunnel') || '{}')
      if (saved.userSeed) setUserSeed(saved.userSeed)
      if (typeof saved.playsLeft === 'number') setPlaysLeft(saved.playsLeft)
      if (typeof saved.cooldownUntil === 'number') setCooldownUntil(saved.cooldownUntil)
    } catch {}
  }, [])
  useEffect(() => {
    localStorage.setItem('ra-tunnel', JSON.stringify({ userSeed, playsLeft, cooldownUntil }))
  }, [userSeed, playsLeft, cooldownUntil])

  async function spin() {
    if (spinning) return
    const now = Date.now()
    if (now < cooldownUntil) return
    if (playsLeft <= 0) {
      setModal({open:true, label:'Out of free plays for Tunnel today'}); return
    }
    setSpinning(true)
    try {
      const r = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userSeed })})
      const d = await r.json()
      if (!d.ok) setModal({open:true, label:d.error || 'Error'})
      else {
        setPlaysLeft(playsLeft-1)
        if (d.nextPlayableAt) setCooldownUntil(d.nextPlayableAt)
        setModal({open:true, label:d.prizeLabel, sub:`hash ${d.serverSeedHash?.slice(0,8)}… • nonce ${d.nonce} • u=${d.u01?.toFixed(6)}`})
      }
    } finally { setSpinning(false) }
  }

  const cd = Math.max(0, Math.ceil((cooldownUntil - Date.now())/1000))

  return (
    <div className="ant-card">
      <div className="flex items-center gap-3 mb-4">
        <img src="/ants-logo.svg" className="h-8 w-24" alt="logo" />
        <span className="badge">Tunnel plays left: <b>{playsLeft}</b></span>
        <span className="badge">Cooldown: <b>{cd}s</b></span>
      </div>
      <h2 className="title">Ant Tunnel Forage</h2>
      <p className="subtitle mb-4">Daily $REBEL forage — steady rewards.</p>
      <div className="grid sm:grid-cols-[1fr_auto] gap-6">
        <div className="rounded-xl border border-slate-800 h-36 grid place-items-center">
          <div className={"h-16 w-16 rounded-full grid place-items-center " + (spinning ? "animate-spin-slow" : "")} style={{border:'4px solid #1f2937'}}>🐜</div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Your seed</label>
            <input value={userSeed} onChange={e=>setUserSeed(e.target.value)} className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2" />
          </div>
          <button className="btn w-full" onClick={spin} disabled={spinning || Date.now() < cooldownUntil}>{spinning ? 'Foraging…' : 'Send Scout'}</button>
        </div>
      </div>
      <PrizeModal open={modal.open} onClose={()=>setModal({...modal, open:false})} label={modal.label} sub={modal.sub||''} />
    </div>
  )
}
