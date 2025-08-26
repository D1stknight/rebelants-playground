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
  const [w, setW] = useState(0)
  const [frame, setFrame] = useState(1)

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
      const distance = Math.max(0, trailRect.width - antRect.width)
      ant.style.setProperty('--travel', `${distance}px`)
    }
    r()
    window.addEventListener('resize', r)
    return () => window.removeEventListener('resize', r)
  }, [])

  async function run() {
    if (busy) return
    setBusy(true)

    const scene = sceneRef.current
    if (!scene) return

    // glow start
    setGlow(null)
    scene.classList.add('running')

    // move progress bar
    const bar = scene.querySelector('.exp-bar') as HTMLDivElement | null
    if (bar) {
      bar.classList.remove('fill')
      await new Promise(r => setTimeout(r, 10))
      bar.classList.add('fill')
    }

    // animate frames
    let f = 1
    let frameInterval: NodeJS.Timeout | null = setInterval(() => {
      f = f % 3 + 1
      setFrame(f)
    }, 250)

    // call backend
    const res = await fetch('/api/expedition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed }),
    })
    const prize: Prize = await res.json()

    // wait 5s (expedition length)
    await new Promise(r => setTimeout(r, 5000))

    // cleanup
    scene.classList.remove('running')
    if (frameInterval) clearInterval(frameInterval)
    setFrame(2) // idle center

    if (prize.type === 'crate') {
      setModal(prize)
      setGlow(prize.rarity)
    }

    setBusy(false)
  }

  return (
    <div>
      <h2 className="title mb-4">Colony Forage Expedition</h2>
      <p className="subtitle mb-6">
        Send a samurai ant on a longer run. 5-second expedition with bigger
        rewards.
      </p>

      <div
        ref={sceneRef}
        className={`scene relative bg-slate-900/70 border border-slate-800 rounded-xl p-8 shadow-lg overflow-hidden ${
          busy ? 'running' : ''
        }`}
      >
        <div className="trail relative h-32 w-full bg-slate-800/40 rounded-lg overflow-hidden">
          {/* glowing aura when reward */}
          {glow && (
            <div
              className={`absolute inset-0 rounded-lg animate-pulse blur-2xl ${
                glow === 'common'
                  ? 'bg-blue-500/30'
                  : glow === 'rare'
                  ? 'bg-purple-500/30'
                  : 'bg-yellow-400/30'
              }`}
            />
          )}

          {/* walking ant */}
          <div
            ref={antRef}
            className="ant absolute bottom-2 left-0 transition-transform duration-[5000ms] ease-linear"
            style={{
              transform: busy
                ? 'translateX(var(--travel, 0px))'
                : 'translateX(0)',
            }}
          >
            <img
              src={`/ant-samurai-${frame}.svg`}
              alt="Samurai Ant"
              className="w-20 h-20 drop-shadow-lg"
            />
          </div>

          {/* progress bar */}
          <div className="exp-bar absolute bottom-0 left-0 h-1 bg-green-400 w-0 transition-all duration-[5000ms]" />
        </div>
      </div>

      <button
        onClick={run}
        disabled={busy}
        className="btn btn-primary mt-6 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-lg"
      >
        {busy ? 'Exploring...' : 'Start Expedition'}
      </button>

      {/* modal */}
      {modal && (
        <div className="modal fixed inset-0 bg-black/70 flex items-center justify-center">
          <div className="modal-card bg-slate-900 border border-slate-700 p-8 rounded-lg shadow-2xl text-center">
            <h3 className="text-xl mb-4">You found:</h3>
            {modal.type === 'crate' ? (
              <div>
                <img
                  src={crateImg[modal.rarity]}
                  alt={`${modal.rarity} crate`}
                  className="w-24 mx-auto animate-bounce"
                />
                <p className="mt-2 text-lg capitalize">
                  {modal.rarity} crate!
                </p>
              </div>
            ) : (
              <p>{modal.label}</p>
            )}
            <button
              className="btn mt-6 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg"
              onClick={() => setModal(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
