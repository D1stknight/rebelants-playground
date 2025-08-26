import React, { useMemo, useState } from 'react'

const crateImg: Record<'common'|'rare'|'ultra', string> = {
  common: '/crates/common.png',
  rare: '/crates/rare.png',
  ultra: '/crates/ultra.png',
}

type Prize =
  | { type: 'crate'; label: string; rarity: 'common'|'rare'|'ultra' }
  | { type: 'none'; label: string }

export default function Shuffle() {
  const [seed] = useState('guest-' + Math.random().toString(36).slice(2,7))
  const [busy, setBusy] = useState(false)
  const [choice, setChoice] = useState<number | null>(null)
  const [modal, setModal] = useState<Prize | null>(null)
  const [glow, setGlow] = useState<'common'|'rare'|'ultra'|null>(null)
  const eggs = useMemo(() => [0,1,2], [])

  async function pick(i: number) {
    if (busy) return
    setBusy(true)
    setChoice(i)

    // quick visual wobble
    await new Promise(r => setTimeout(r, 300))

    try {
      const res = await fetch('/api/shuffle', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ seed, pick: i })
      })
      if (!res.ok) throw new Error(await res.text())
      const r = await res.json()
      const p: Prize = r?.prize?.rarity && r?.prize?.rarity !== 'none'
        ? { type: 'crate', label: r.prize.label, rarity: r.prize.rarity }
        : { type: 'none', label: 'Nothing this time' }

      // glow mapping
      if (p.type === 'crate') setGlow(p.rarity)
      else setGlow(null)

      setModal(p)
    } catch {
      setModal({ type: 'none', label: 'Nothing this time' })
      setGlow(null)
    } finally {
      setBusy(false)
    }
  }

  // sparkles for Ultra
  function renderSparkles() {
    if (glow !== 'ultra') return null
    const dots = Array.from({length: 12})
    return (
      <div className="sparkles">
        {dots.map((_,i) => (
          <i key={i} style={{
            left: `${20 + Math.random()*60}%`,
            top: `${30 + Math.random()*15}%`,
            animationDelay: `${Math.random()*400}ms`
          }} />
        ))}
      </div>
    )
  }

  return (
    <section>
      <h2 className="text-xl font-semibold mb-2">Queen’s Egg Shuffle</h2>
      <p className="text-slate-400 mb-4">Three eggs. Pick one. Flip for a prize.</p>

      <div className="flex gap-6 items-center">
        {eggs.map(i => {
          const picked = choice === i
          return (
            <button
              key={i}
              disabled={busy}
              onClick={() => pick(i)}
              className={[
                "h-24 w-20 grid place-items-center rounded-xl border border-slate-800",
                "bg-slate-900 hover:bg-slate-800 transition",
                picked ? "pick-anim wobble-quick" : "floaty"
              ].join(" ")}
              aria-label={`Pick egg ${i+1}`}
            >
              <span className="text-2xl">🥚</span>
            </button>
          )
        })}
      </div>

      {modal && (
        <div className="modal">
          <div className="modal-card bounce-in shine-wrap"
               style={{ position:'relative' }}>
            <div className="text-lg font-semibold mb-2">You found:</div>

            {modal.type === 'crate' ? (
              <>
                <div className="mb-2">{modal.label}</div>
                <div className={[
                    "mx-auto w-28 rounded-xl p-2",
                    modal.rarity === 'ultra' ? "glow-ultra" :
                    modal.rarity === 'rare'  ? "glow-rare"  :
                                               "glow-common"
                  ].join(" ")}
                  style={{ background:'rgba(8,10,20,.35)' }}
                >
                  <img src={crateImg[modal.rarity]} alt={modal.rarity} className="mx-auto block" />
                </div>
                {renderSparkles()}
              </>
            ) : (
              <div className="mb-2">Nothing this time</div>
            )}

            <button className="btn mt-3"
              onClick={() => { setModal(null); setChoice(null); setGlow(null); }}>
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
