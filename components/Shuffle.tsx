import React, { useEffect, useMemo, useRef, useState } from 'react'

type PrizeDetail = { label: string; sub?: string; rarity?: 'common'|'rare'|'ultra' | null }

function showPrize(detail: PrizeDetail) {
  // If you added PrizeModalHost earlier, it listens for this event:
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('prize:show', { detail }))
  } else {
    // Build-time precaution
    console.log('Prize:', detail)
  }
}

/* Utility to emit fallback if host not present */
function showPrizeWithFallback(detail: PrizeDetail) {
  try {
    showPrize(detail)
  } catch (e) {
    alert(`${detail.label}${detail.sub ? '\n' + detail.sub : ''}`)
  }
}

export default function Shuffle() {
  // 3 slots across the row: indices 0,1,2
  const [slots, setSlots] = useState<[number, number, number]>([0, 1, 2]) // which egg sits in each slot
  const [shuffling, setShuffling] = useState(false)
  const [canPick, setCanPick] = useState(false)
  const [seed] = useState('guest-' + Math.random().toString(36).slice(2, 8))
  const [shakeIdx, setShakeIdx] = useState<number | null>(null)

  // absolute positions (in %) for the centers of the 3 columns
  const positions = useMemo(() => [8, 42, 76], [])

  // runs the shell shuffle animation
  async function runShuffle() {
    if (shuffling) return
    setCanPick(false)
    setShuffling(true)

    // Start from a clean left->right mapping
    setSlots([0, 1, 2])

    // number of swaps
    const swaps = Math.floor(10 + Math.random() * 5)
    for (let i = 0; i < swaps; i++) {
      await new Promise((r) => setTimeout(r, 350 + Math.random() * 150))
      setSlots((prev) => {
        // choose two distinct indices to swap
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

    // tiny settle delay
    await new Promise((r) => setTimeout(r, 350))
    setShuffling(false)
    setCanPick(true)
  }

  async function pickEgg(slotIndex: number) {
    if (!canPick || shuffling) return

    // click feedback: shake that egg
    setShakeIdx(slotIndex)
    setTimeout(() => setShakeIdx(null), 750)

    try {
      const res = await fetch('/api/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed }),
      })
      const data = await res.json()

      // your /api/spin returns something like: { ok:true, prizeLabel:string, rarity?:'common'|'rare'|'ultra' }
      const label = (data?.prizeLabel as string) || 'Nothing this time'
      const rarity = (data?.rarity as PrizeDetail['rarity']) ?? null

      showPrizeWithFallback({
        label,
        sub: rarity ? `Rarity: ${rarity}` : 'Better luck next time.',
        rarity,
      })
    } catch (e) {
      showPrizeWithFallback({ label: 'Oops', sub: 'Network error. Try again.' })
    } finally {
      // let users shuffle again
      setCanPick(false)
    }
  }

  return (
    <div className="ant-card">
      <h2 className="title mb-2">Queen&apos;s Egg Shuffle</h2>
      <p className="subtitle mb-4">Three eggs. We shuffle. You pick one for a prize.</p>

      <div className="shuffle-box">
        {/* visual floor */}
        <div className="shuffle-floor" />

        {/* Eggs */}
        {[0, 1, 2].map((slotIndex) => {
          // which logical egg sits in this slot? (not actually used for prize; purely visual)
          const eggId = slots[slotIndex]
          return (
            <button
              key={slotIndex}
              disabled={!canPick}
              onClick={() => pickEgg(slotIndex)}
              className={`egg-card ${canPick ? 'can-pick' : ''} ${shakeIdx === slotIndex ? 'wobble' : ''}`}
              style={{
                left: `${positions[slotIndex]}%`,
                transition: 'transform 320ms ease, left 320ms ease',
                // tiny z offset to help crossings look smooth
                transform: `translateZ(0)`,
              }}
            >
              <div className="egg glossy group-hover:wobble" aria-label={`egg-${eggId}`} />
              <div className="egg-shadow" />
            </button>
          )
        })}
      </div>

      <div className="mt-4 flex gap-3">
        <button
          onClick={runShuffle}
          disabled={shuffling}
          className="btn"
          title={shuffling ? 'Shuffling…' : 'Shuffle the eggs'}
        >
          {shuffling ? 'Shuffling…' : 'Shuffle'}
        </button>
        <button
          onClick={() => setCanPick(true)}
          disabled={shuffling || canPick}
          className="btn"
          title="Enable picking"
        >
          {canPick ? 'Pick enabled' : 'Enable Pick'}
        </button>
      </div>

      <footer className="mt-8 text-sm text-slate-500">
        <a className="underline" href="/rules">Official Rules</a>
      </footer>
    </div>
  )
}
