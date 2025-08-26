import React, { useMemo, useState } from 'react'

type PrizeDetail = { label: string; sub?: string; rarity?: 'common'|'rare'|'ultra' | null }

const CRATE_BY_RARITY: Record<NonNullable<PrizeDetail['rarity']>, string> = {
  common: '/crates/common.png',
  rare: '/crates/rare.png',
  ultra: '/crates/ultra.png',
}

export default function Shuffle() {
  const [slots, setSlots] = useState<[number, number, number]>([0, 1, 2])
  const [phase, setPhase]   = useState<'idle'|'shuffling'|'pick'|'reveal'>('idle')
  const [shakeIdx, setShakeIdx] = useState<number | null>(null)
  const [seed] = useState('guest-' + Math.random().toString(36).slice(2, 8))

  // prize overlay state (local to this component)
  const [prize, setPrize] = useState<PrizeDetail | null>(null)

  // fixed visual x-positions for slots
const positions = useMemo(() => [20, 50, 80], [])

  async function startShuffle() {
    if (phase === 'shuffling') return
    setPrize(null)
    setPhase('shuffling')

    // reset positions (eggId matches slot index)
    setSlots([0, 1, 2])

    const swaps = Math.floor(10 + Math.random() * 5)
    for (let i = 0; i < swaps; i++) {
      await new Promise((r) => setTimeout(r, 320 + Math.random() * 120))
      setSlots((prev) => {
        let a = Math.floor(Math.random() * 3)
        let b = Math.floor(Math.random() * 3)
        while (b === a) b = Math.floor(Math.random() * 3)
        const next = [...prev] as [number, number, number]
        const tmp = next[a]
        next[a] = next[b]
        next[b] = tmp
        return next
      })
    }

    await new Promise((r) => setTimeout(r, 280))
    setPhase('pick')
  }

  async function pick(slotIndex: number) {
    if (phase !== 'pick') return
    setShakeIdx(slotIndex)
    setTimeout(() => setShakeIdx(null), 650)

    try {
      const res = await fetch('/api/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed }),
      })
      const data = await res.json()

      const label  = (data?.prizeLabel as string) || 'Nothing this time'
      const rarity = (data?.rarity as PrizeDetail['rarity']) ?? null
      setPrize({ label, sub: rarity ? `Rarity: ${rarity}` : 'The Queen says try again.', rarity })
      setPhase('reveal')
    } catch {
      setPrize({ label: 'Network error', sub: 'Please try again.', rarity: null })
      setPhase('reveal')
    }
  }

  // Render eggs by eggId; compute its current slot to set position
  const eggs = [0, 1, 2]

  return (
    <div className="ant-card">
      <h2 className="title mb-2">Queen&apos;s Egg Shuffle</h2>
      <p className="subtitle mb-4">Three eggs. We shuffle. You pick one for a prize.</p>

      <div className="shuffle-scene">
        <div className="shuffle-bg" />
        <div className="shuffle-queen" aria-hidden />

        {/* sparkle ambience */}
        <div className="shuffle-motes" aria-hidden />
        <div className="shuffle-motes delay" aria-hidden />

        {eggs.map((eggId) => {
          const slotIndex = slots.indexOf(eggId)
          const left = positions[slotIndex]
          const pickable = phase === 'pick'
          return (
            <button
              key={eggId}
              className={`shuffle-egg ${pickable ? 'is-pickable' : ''} ${shakeIdx === slotIndex ? 'is-shaking' : ''}`}
              style={{ left: `${left}%` }}
              disabled={!pickable}
              onClick={() => pick(slotIndex)}
              aria-label={`Pick egg ${eggId + 1}`}
            >
              <div className="egg-sheen" />
              <div className="egg-body" />
              <div className="egg-shadow" />
            </button>
          )
        })}

        {/* floor bar */}
        <div className="shuffle-floor" />
      </div>

      <div className="mt-4">
        <button className="btn" onClick={startShuffle} disabled={phase === 'shuffling'}>
          {phase === 'shuffling' ? 'Shuffling…' : 'Shuffle'}
        </button>
      </div>

      {/* Local themed result overlay */}
      {phase === 'reveal' && prize && (
        <div className="prize-overlay" role="dialog" aria-modal="true">
          <div className="prize-card">
            <div className="prize-title">You found:</div>
            <div className="prize-label">{prize.label}</div>

            {prize.rarity && (
              <img
                src={CRATE_BY_RARITY[prize.rarity]}
                alt={prize.rarity}
                className="prize-crate"
                width={128}
                height={128}
              />
            )}

            {prize.sub && <div className="prize-sub">{prize.sub}</div>}

            <button className="btn mt-4" onClick={() => { setPrize(null); setPhase('idle') }}>
              Close
            </button>

            {/* subtle burst */}
            <div className="prize-burst" aria-hidden />
          </div>
        </div>
      )}

      <footer className="mt-8 text-sm text-slate-500">
        <a className="underline" href="/rules">Official Rules</a>
      </footer>
    </div>
  )
}
