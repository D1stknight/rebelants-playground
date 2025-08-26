import React, { useEffect, useRef, useState } from 'react'

type Prize =
  | { type: 'crate'; label: string; rarity: 'common'|'rare'|'ultra' }
  | { type: 'none';  label: string }

const crateImg: Record<'common'|'rare'|'ultra', string> = {
  common: '/crates/common.png',
  rare: '/crates/rare.png',
  ultra: '/crates/ultra.png',
}

export default function Expedition() {
  const [busy, setBusy] = useState(false)
  const [seed] = useState('guest-' + Math.random().toString(36).slice(2,8))
  const [modal, setModal] = useState<Prize | null>(null)
  const [glow, setGlow] = useState<'common'|'rare'|'ultra'|null>(null)
  const [w, setW] = useState(0) // progress 0..100

  const sceneRef = useRef<HTMLDivElement>(null)
  const antRef = useRef<HTMLDivElement>(null)

  // set ant travel distance precisely based on trail width (CSS anim uses this value)
  useEffect(() => {
    const r = () => {
      const scene = sceneRef.current
      const ant = antRef.current
      const trail = scene?.querySelector('.trail') as HTMLDivElement | null
      if (!scene || !ant || !trail) return
      const trailRect = trail.getBoundingClientRect()
      const antRect = ant.getBoundingClientRect()
      const distance = Math.max(0, trailRect.width - antRect.width)
      // we move the ant with JS translate during the run for accuracy
      ant.style.setProperty('--travel', `${distance}px`)
    }
    r()
    window.addEventListener('resize', r)
    return () => window.removeEventListener('resize', r)
  }, [])

  function confettiBurst(container: HTMLElement) {
    const conf = document.createElement('div')
    conf.className = 'confetti'
    container.appendChild(conf)
    const colors = ['#ff6b6b','#ffd93d','#6bcBff','#B28DFF','#7CFFB2','#ff9f43']
    for (let i=0;i<28;i++){
      const el = document.createElement('i')
      el.style.left = `${10 + Math.random()*80}%`
      el.style.top  = `${20 + Math.random()*10}%`
      el.style.background = colors[i % colors.length]
      el.style.transform = `translateY(-20px) rotate(${Math.random()*180}deg)`
      el.style.animationDelay = `${Math.random()*200}ms`
      conf.appendChild(el)
    }
    setTimeout(()=>conf.remove(), 1200)
  }

  async function run() {
    if (busy) return
    setBusy(true)
    setModal(null)
    setGlow(null)
    setW(0)

    // enable scene animation & start the “march”
    const scene = sceneRef.current
    const ant = antRef.current
    scene?.classList.add('animating','running')

    // drive progress & ant movement (~5.2s)
    const start = Date.now()
    const dur = 5200
    const trail = scene?.querySelector('.trail') as HTMLDivElement | null
    const travel = ant ? parseFloat(getComputedStyle(ant).getPropertyValue('--travel')) || 0 : 0

    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / dur)
      setW(Math.round(t * 100))
      if (ant) ant.style.transform = `translateX(${travel * t}px)`
      if (t < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)

    // ask the API
    let prize: Prize = { type:'none', label:'Nothing this time' }
    try {
      const res = await fetch('/api/expedition', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ seed })
      })
      if (res.ok) {
        const r = await res.json()
        const p = r?.prize
        if (p?.type === 'crate') {
          prize = { type:'crate', label: p.label, rarity: p.rarity }
        }
      }
    } catch (_) {}

    // finish the run
    await new Promise(r => setTimeout(r, dur))
    scene?.classList.remove('running')
    if (prize.type === 'crate') {
      setGlow(prize.rarity)
      if (prize.rarity !== 'common' && scene) confettiBurst(scene)
    }
    setModal(prize)
    setBusy(false)
  }

  return (
    <section>
      <h2 className="text-xl font-semibold mb-2">Colony Forage Expedition</h2>
      <p className="text-slate-400 mb-4">Send a scout on a longer run. Bigger rewards, cinematic vibes.</p>

      {/* Scene */}
      <div ref={sceneRef} className="exp-scene mb-4">
        {/* fireflies */}
        <div className="fireflies">
          {Array.from({length:14}).map((_,i)=>(
            <i key={i} style={{
              left: `${Math.random()*100}%`,
              top:  `${10 + Math.random()*60}%`,
              animationDelay: `${Math.random()*2000}ms`
            }} />
          ))}
        </div>

        <div className="hills"></div>
        <div className="trail"></div>

        {/* Ant — Rebel Ant Samurai */}
        <div ref={antRef} className="ant" aria-hidden="true">
          <img src="/ant-samurai.svg" alt="Rebel Ant Samurai" className="w-16 h-16 animate-bounce-slow" />
        </div>
      </div>

      {/* Progress + CTA */}
      <div className="exp-bar mb-3">
        <div className="bar-fill" style={{ width: `${w}%` }} />
      </div>
      <button className="btn" disabled={busy} onClick={run}>
        {busy ? 'Marching...' : 'Start Expedition'}
      </button>

      {/* Prize Modal */}
      {modal && (
        <div className="modal">
          <div className="modal-card bounce-in" style={{ position:'relative' }}>
            <div className="text-lg font-semibold mb-2">You found:</div>
            {modal.type === 'crate' ? (
              <>
                <div className="mb-2">{modal.label}</div>
                <div className={[
                  "prize-wrap mx-auto w-28 rounded-xl p-2 shine",
                  glow==='ultra' ? "glow-ultra" : glow==='rare' ? "glow-rare" : "glow-common"
                ].join(' ')}
                style={{ background:'rgba(8,10,20,.35)' }}>
                  <img src={crateImg[modal.rarity]} alt={modal.rarity} className="mx-auto block" />
                </div>
              </>
            ) : (
              <div className="mb-2">Nothing this time</div>
            )}
            <button className="btn mt-3" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}
    </section>
  )
}
