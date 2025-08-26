import React, { useEffect, useState } from 'react'

type PrizeDetail =
  | { title: string; type: 'crate'; rarity: 'common' | 'rare' | 'ultra'; label?: string }
  | { title: string; type: 'none' }

export default function PrizeModalHost() {
  const [open, setOpen] = useState(false)
  const [prize, setPrize] = useState<PrizeDetail | null>(null)

  useEffect(() => {
    const onPrize = (e: Event) => {
      const detail = (e as CustomEvent<PrizeDetail>).detail
      if (!detail) return
      setPrize(detail)
      setOpen(true)
    }
    window.addEventListener('rebelants:prize', onPrize as EventListener)
    return () => window.removeEventListener('rebelants:prize', onPrize as EventListener)
  }, [])

  if (!open || !prize) return null

  const imgByRarity: Record<'common' | 'rare' | 'ultra', string> = {
    common: '/crates/common.png',
    rare: '/crates/rare.png',
    ultra: '/crates/ultra.png',
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="title mb-2">You found:</h3>
        {'type' in prize && prize.type === 'crate' ? (
          <div className="flex items-center gap-4">
            <img
              src={imgByRarity[prize.rarity]}
              width={120}
              height={120}
              alt={`${prize.rarity} loot crate`}
            />
            <div>
              <div className="text-lg font-semibold capitalize">{prize.rarity} Loot Crate</div>
              {prize.label ? <div className="text-slate-400 text-sm">{prize.label}</div> : null}
            </div>
          </div>
        ) : (
          <div className="text-slate-300">Nothing this time.</div>
        )}
        <button className="btn mt-5" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </div>
  )
}
