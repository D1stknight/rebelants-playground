import React, { useEffect, useRef, useState } from 'react'

type Prize =
  | { type: 'crate'; label: string; rarity: 'common' | 'rare' | 'ultra' }
  | { type: 'none'; label: string }

const crateImg: Record<'common' | 'rare' | 'ultra', string> = {
  common: '/crates/common.png',
  rare: '/crates/rare.png',
  ultra: '/crates/ultra.png',
}

export default function Expedition() {
  const [busy, setBusy] = useState(false)
  const [seed] = useState('guest-' + Math.random().toString(36).slice(2, 8))
  const [modal, setModal] = useState<Prize | null>(null)
  const [glow, setGlow] = useState<'common' | 'rare' | 'ultra' | null>(null)
  const [frame, setFrame] = useState(2)

  const sceneRef = useRef<HTMLDivElement>(null)
  const antRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const r = () => {
      const scene = sceneRef.current
      const ant = antRef.current
      const trail = scene?.querySelector('.trail') as HTMLDivElement | null
      if (!scene || !ant || !trail) return
      const trailRect = trail.getBoundingClientRect()
      const antRect = ant.getBoundingClientRect()
      const distance = Math.max(0, trailRect.width - antRect.width - 16)
      ant.style.setProperty('--travel', `${distance}px`)
    }
    r()
    window.addEventListener('resize', r)
    return () => window.removeEventListener('resize', r)
  }, [])

  async function run() {
    if (busy) return
    setBusy(true)
    setGlow(null)
    setModal(null)

    const scene = sceneRef.current
    scene?.classList.add('running')

    // progress bar restart
    const bar = scene?.querySelector('.exp-bar') as HTMLDivElement | null
    if (bar) {
      bar.classList.remove('fill')
      await new Promise(r => setTimeout(r, 10))
      bar.classList.add('fill')
    }

    // walk cycle
    let f = 1
    const frameInterval = setInterval(() => {
      f = (f % 3) + 1
      setFrame(f)
    }, 250)

    scene?.classList.add('shine')

    // fetch result
    let prize: Prize = { type: 'none', label: 'Nothing this time' }
    try {
      const res = await fetch('/api/expedition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed }),
      })
      prize = await res.json()
    } catch (e) {
      prize = { type: 'none', label: 'Network error — try again' }
    }

    // let the 5s animation play
    await new Promise(r => setTimeout(r, 5000))

    scene?.classList.remove('running', 'shine')
    clearInterval(frameInterval)
    setFrame(2)

    // NEW: show a modal for every outcome
    if (prize.type === 'crate') {
      setGlow(prize.rarity)
    }
    setModal(prize)

    setBusy(false)
  }

  return (
    <div>
      <h2 className="title mb-2">Colony Forage Expedition</h2>
      <p className="subtitle mb-6">Send a samurai ant on a longer run. 5-second expedition with bigger rewards.</p>

      <div ref={sceneRef} className="scene ant-scene rounded-xl overflow-hidden border border-slate-800">
        <div className="sky">
          <div className="stars" />
          <div className="aurora" />
          <div className="clouds" />
        </div>

        <div className="hills" />
        <div className="ground" />

        <div className="trail">
          {glow && <div className={`reward-aura ${glow}`} />}
          <div className="exp-bar" />
        </div>

        <div
          ref={antRef}
          className={`ant ${busy ? 'walking' : 'idle'}`}
          style={{ transform: busy ? 'translateX(var(--travel, 0px))' : undefined }}
        >
          <img src={`/ant-samurai-${frame}.svg`} alt="Samurai Ant" className="ant-img" />
          <div className="shadow" />
        </div>

        <div className="grass fg" />
      </div>

      <button
        onClick={run}
        disabled={busy}
        className="btn btn-primary mt-6 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-lg active:scale-[.98] transition"
      >
        {busy ? 'Exploring…' : 'Start Expedition'}
      </button>

      {modal && (
        <div className="modal fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="modal-card bg-slate-900 border border-slate-700 p-8 rounded-xl text-center bounce-in max-w-sm">
            <h3 className="text-xl mb-4">You found:</h3>
            {modal.type === 'crate' ? (
              <>
                <img src={crateImg[modal.rarity]} alt={`${modal.rarity} crate`} className="w-24 mx-auto" />
                <p className="mt-3 text-lg capitalize">{modal.rarity} crate!</p>
              </>
            ) : (
              <p className="text-slate-300">{modal.label}</p>
            )}
            <button className="btn mt-6 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg" onClick={() => setModal(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
