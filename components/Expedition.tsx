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
  const [frame, setFrame] = useState(2) // 1-2-3 cycle, 2 = center/idle

  const sceneRef = useRef<HTMLDivElement>(null)
  const antRef = useRef<HTMLDivElement>(null)

  // Recompute travel distance so the ant walks the full trail
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

    const scene = sceneRef.current
    scene?.classList.add('running')

    // restart/animate progress bar
    const bar = scene?.querySelector('.exp-bar') as HTMLDivElement | null
    if (bar) {
      bar.classList.remove('fill')
      // tiny delay so the CSS transition re-triggers
      await new Promise(r => setTimeout(r, 10))
      bar.classList.add('fill')
    }

    // walk cycle (250ms per frame)
    let f = 1
    let frameInterval: NodeJS.Timeout | null = setInterval(() => {
      f = (f % 3) + 1
      setFrame(f)
    }, 250)

    // start katana shimmer loop (purely cosmetic)
    scene?.classList.add('shine')

    // ask “server” for result
    const res = await fetch('/api/expedition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed }),
    })
    const prize: Prize = await res.json()

    // expedition length: 5s (matches CSS)
    await new Promise(r => setTimeout(r, 5000))

    scene?.classList.remove('running', 'shine')
    if (frameInterval) clearInterval(frameInterval)
    setFrame(2) // idle

    if (prize.type === 'crate') {
      setGlow(prize.rarity)
      setModal(prize)
    }

    setBusy(false)
  }

  return (
    <div>
      <h2 className="title mb-2">Colony Forage Expedition</h2>
      <p className="subtitle mb-6">
        Send a samurai ant on a longer run. 5-second expedition with bigger rewards.
      </p>

      <div ref={sceneRef} className="scene ant-scene rounded-xl overflow-hidden border border-slate-800">
        {/* parallax sky */}
        <div className="sky">
          <div className="stars" />
          <div className="aurora" />
          <div className="clouds" />
        </div>

        {/* hills/ground */}
        <div className="hills" />
        <div className="ground" />

        {/* trail the ant walks on */}
        <div className="trail">
          {glow && <div className={`reward-aura ${glow}`} />}
          <div className="exp-bar" />
        </div>

        {/* ant */}
        <div
          ref={antRef}
          className={`ant ${busy ? 'walking' : 'idle'}`}
          style={{ transform: busy ? 'translateX(var(--travel, 0px))' : undefined }}
        >
          {/* swap frames: you can keep your SVGs, or later we’ll drop in high-fidelity PNGs */}
          <img src={`/ant-samurai-${frame}.svg`} alt="Samurai Ant" className="ant-img" />
          <div className="shadow" />
        </div>

        {/* foreground grass for depth */}
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
          <div className="modal-card bg-slate-900 border border-slate-700 p-8 rounded-xl text-center bounce-in">
            <h3 className="text-xl mb-4">You found:</h3>
            {modal.type === 'crate' ? (
              <div className="prize-wrap shine">
                <img
                  src={crateImg[modal.rarity]}
                  alt={`${modal.rarity} crate`}
                  className={`w-24 mx-auto ${modal.rarity === 'ultra' ? 'animate-bounce' : ''}`}
                />
                <p className="mt-3 text-lg capitalize">{modal.rarity} crate!</p>
              </div>
            ) : (
              <p>{modal.label}</p>
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
