import React, { useMemo, useState } from 'react'

type Variant = 'hatch' | 'shuffle'
type PrizeDetail =
  | { title: string; type: 'crate'; rarity: 'common' | 'rare' | 'ultra'; label?: string }
  | { title: string; type: 'none' }

const crateImg: Record<'common' | 'rare' | 'ultra', string> = {
  common: '/crates/common.png',
  rare: '/crates/rare.png',
  ultra: '/crates/ultra.png',
}

function announce(detail: PrizeDetail) {
  window.dispatchEvent(new CustomEvent<PrizeDetail>('rebelants:prize', { detail }))
}

export default function QueenEgg(props: { variant?: Variant }) {
  const variant: Variant = props.variant ?? 'hatch'
  const [busy, setBusy] = useState(false)
  const seed = useMemo(() => 'guest-' + Math.random().toString(36).slice(2, 8), [])

  async function crackSingle() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/hatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed }),
      })
      const data: any = await res.json()
      if (data?.type === 'crate' && data?.rarity) {
        announce({ title: 'You found:', type: 'crate', rarity: data.rarity, label: data.label })
      } else {
        announce({ title: 'You found:', type: 'none' })
      }
    } catch {
      announce({ title: 'You found:', type: 'none' })
    } finally {
      setBusy(false)
    }
  }

  async function pickEgg(index: number) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/shuffle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, pick: index }),
      })
      const data: any = await res.json()
      if (data?.type === 'crate' && data?.rarity) {
        announce({ title: 'You found:', type: 'crate', rarity: data.rarity, label: data.label })
      } else {
        announce({ title: 'You found:', type: 'none' })
      }
    } catch {
      announce({ title: 'You found:', type: 'none' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ant-card">
      <h2 className="title mb-2">Queen&apos;s Egg {variant === 'shuffle' ? 'Shuffle' : 'Hatch'}</h2>
      <p className="subtitle mb-4">
        {variant === 'shuffle'
          ? 'Three eggs. Pick one. Flip for a prize.'
          : "Crack an egg for a shot at the Queen's crates. Jackpot vibes."}
      </p>

      {variant === 'hatch' ? (
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-slate-800 shadow-inner grid place-items-center">
            <div className="w-6 h-6 bg-yellow-300 rounded-full"></div>
          </div>
          <button className="btn btn-primary" onClick={crackSingle} disabled={busy}>
            {busy ? 'Cracking…' : 'Crack Egg'}
          </button>
        </div>
      ) : (
        <div className="flex gap-4">
          {[0, 1, 2].map((i) => (
            <button
              key={i}
              onClick={() => pickEgg(i)}
              disabled={busy}
              className="w-20 h-28 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 transition grid place-items-center"
            >
              <div className="w-7 h-7 bg-yellow-300 rounded-full" />
            </button>
          ))}
        </div>
      )}

      {/* NOTE: No <PrizeModal /> here anymore — we fire a window event and the global modal shows itself */}
    </section>
  )
}
