import React, { useMemo, useState } from 'react'

type PrizeDetail = { label: string; sub?: string; rarity?: 'common'|'rare'|'ultra' | null }

function showPrize(detail: PrizeDetail) {
  if (typeof window !== 'undefined') {
    // If PrizeModalHost exists it will catch this. Otherwise we'll alert below.
    window.dispatchEvent(new CustomEvent('prize:show', { detail }))
  }
}

export default function Shuffle() {
  // slots = which eggId sits at each slot index (0..2)
  // start left→right: slot0=egg0, slot1=egg1, slot2=egg2
  const [slots, setSlots] = useState<[number, number, number]>([0, 1, 2])
  const [isShuffling, setIsShuffling] = useState(false)
  const [canPick, setCanPick] = useState(false)
  const [shakeIdx, setShakeIdx] = useState<number | null>(null)
  const [seed] = useState('guest-' + Math.random().toString(36).slice(2, 8))

  // fixed visual x-positions for slots
  const positions = useMemo(() => [10, 45, 80], [])

  async function startShuffle() {
    if (isShuffling) return
    setCanPick(false)
    setIsShuffling(true)

    // reset to ordered
    setSlots([0, 1, 2])

    const swaps = Math.floor(10 + Math.random() * 5)
    for (let i = 0; i < swaps; i++) {
      await new Promise((r) => setTimeout(r, 320 + Math.random() * 120))
      setSlots((prev) => {
        // swap two slot positions
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

    await new Promise((r) => setTimeout(r, 300))
    setIsShuffling(false)
    setCanPick(true)
  }

  async function pick(slotIndex: number) {
    if (!canPick || isShuffling) return

    setShakeIdx(slotIndex)
    setTimeout(() => setShakeIdx(null), 700)

    try {
      const res = await fetch('/api/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed }),
      })
      const data = await res.json()
      const label = (data?.prizeLabel as string) || 'Nothing this time'
      const rarity = (data?.rarity as PrizeDetail['rarity']) ?? null

      // try global modal first
      showPrize({
        label,
        sub: rarity ? `Rarity: ${rarity}` : 'Better luck next time.',
        rarity,
      })

      // fallback if no host is listening
      setTimeout(() => {
        // @ts-ignore
        if (!window.__PRIZE_MODAL_HANDLED__) {
          alert(`${label}${rarity ? `\nRarity: ${rarity}` : ''}`)
        }
      }, 50)
    } catch (e) {
      alert('Network error. Try again.')
    } finally {
      setCanPick(false) // must shuffle again for another pick
    }
  }

  // We render by EGG id (0..2). For each egg, find which slot it currently occupies.
  const eggs = [0, 1, 2]

  return (
    <div className="ant-card">
      <h2 className="title mb-2">Queen&apos;s Egg Shuffle</h2>
      <p className="subtitle mb-4">Three eggs. We shuffle. You pick one for a prize.</p>

      <div className="shuffle-scene">
        <div className="shuffle-bg" />
        {/* (Optional) Queen silhouette – purely decorative */}
        <div className="shuffle-queen" aria-hidden />

        {/* Eggs (rendered by eggId; positioned by its slot index) */}
        {eggs.map((eggId) => {
          const slotIndex = slots.indexOf(eggId) // <-- THIS makes them actually move
          const left = positions[slotIndex]
          return (
            <button
              key={eggId}
              className={`shuffle-egg ${canPick ? 'is-pickable' : ''} ${shakeIdx === slotIndex ? 'is-shaking' : ''}`}
              style={{ left: `${left}%` }}
              disabled={!canPick}
              onClick={() => pick(slotIndex)}
              aria-label={`Pick egg ${eggId + 1}`}
            >
              <div className="egg-body" />
              <div className="egg-shadow" />
            </button>
          )
        })}

        {/* floor bar */}
        <div className="shuffle-floor" />
      </div>

      <div className="mt-4">
        <button className="btn" onClick={startShuffle} disabled={isShuffling}>
          {isShuffling ? 'Shuffling…' : 'Shuffle'}
        </button>
      </div>

      <footer className="mt-8 text-sm text-slate-500">
        <a className="underline" href="/rules">Official Rules</a>
      </footer>
    </div>
  )
}
