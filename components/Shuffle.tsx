import React, { useEffect, useMemo, useRef, useState } from 'react'

type Prize = { prizeLabel: string; rarity: 'common'|'rare'|'ultra'|null }

const crateImg: Record<'common'|'rare'|'ultra', string> = {
  common: '/crates/common.png',
  rare: '/crates/rare.png',
  ultra: '/crates/ultra.png',
}

export default function Shuffle(){
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [canPick, setCanPick] = useState(false)
  const [modal, setModal] = useState<{open:boolean; prize?: Prize}>({open:false})

  // Center points for each slot across the track
  const positions = useMemo(() => [20, 50, 80], [])
  // During shuffle, we move a “sheen” panel across the scene for flair
  const sheenRef = useRef<HTMLDivElement|null>(null)
  const barRef = useRef<HTMLDivElement|null>(null)

  function animateSheen(ms: number){
    const start = performance.now()
    const raf = () => {
      const t = performance.now() - start
      const pct = Math.min(1, t / ms)
      if (sheenRef.current){
        const x = -40 + pct * 180 // move across
        sheenRef.current.style.transform = `skewX(-15deg) translateX(${x}%)`
      }
      if (pct < 1) requestAnimationFrame(raf)
    }
    requestAnimationFrame(raf)
  }

  async function doShuffle(){
    if (running) return
    setModal({open:false})
    setCanPick(false)
    setRunning(true)
    setProgress(0)

    // progress bar + sheen sweep
    animateSheen(1400)
    const start = Date.now()
    const total = 1400
    const interval = setInterval(() => {
      const pct = Math.min(100, Math.round(((Date.now()-start)/total)*100))
      setProgress(pct)
      if (pct >= 100){
        clearInterval(interval)
        setRunning(false)
        setCanPick(true)
      }
    }, 60)
  }

  async function pick(index:number){
    if (!canPick) return
    setCanPick(false)
    // Seed can be anything; we use the index to tie choice to result a bit
    const seed = `guest-${index}-${Date.now()}`
    const res = await fetch('/api/spin', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ seed }),
    }).then(r=>r.json())

    const prize: Prize = { prizeLabel: res.prizeLabel ?? 'Nothing this time', rarity: res.rarity ?? null }
    setModal({open:true, prize})
  }

  return (
    <section className="ant-card">
      <h3 className="title mb-1">Queen&apos;s Egg Shuffle</h3>
      <p className="subtitle mb-4">Three eggs. We shuffle. You pick one for a prize.</p>

      {/* Scene */}
      <div className="shuffle-wrap">
        <div className="sky">
          <div className="stars" />
          <div ref={sheenRef} className="sheen" />
        </div>

        {/* floor */}
        <div className="shuffle-floor" />

        {/* three slots */}
        {positions.map((x, i)=>(
          <div key={i} className="egg-slot" style={{left:`${x}%`}}>
            <div
              className={`shuffle-egg ${canPick ? 'cursor-pointer' : 'opacity-80'}`}
              onClick={()=>pick(i)}
              onMouseEnter={(e)=> e.currentTarget.classList.add('wobble')}
              onAnimationEnd={(e)=> e.currentTarget.classList.remove('wobble')}
              aria-label={`Egg ${i+1}`}
              role="button"
            />
          </div>
        ))}
      </div>

      {/* progress */}
      <div className="bar mt-4">
        <div ref={barRef} className="bar-fill" style={{width:`${progress}%`}} />
      </div>

      {/* controls */}
      <div className="mt-4 flex gap-3">
        <button className="btn" onClick={doShuffle} disabled={running}>
          {running ? 'Shuffling…' : 'Shuffle'}
        </button>
      </div>

      {/* Prize Modal */}
      {modal.open && (
        <div className="modal" onClick={()=>setModal({open:false})}>
          <div className="modal-card pop-in" onClick={(e)=>e.stopPropagation()}>
            <h4 className="text-lg font-semibold mb-2">Result</h4>
            {modal.prize?.rarity ? (
              <>
                <p className="mb-3">{modal.prize.prizeLabel}</p>
                <img
                  alt={modal.prize.rarity}
                  className="mx-auto w-28"
                  src={crateImg[modal.prize.rarity]}
                />
              </>
            ) : (
              <p className="mb-3">Nothing this time</p>
            )}
            <button className="btn mt-4" onClick={()=>setModal({open:false})}>Close</button>
          </div>
        </div>
      )}
    </section>
  )
}
