import React, { useEffect, useMemo, useRef, useState } from 'react';

type Phase = 'idle' | 'shuffling' | 'pick' | 'reveal';

type PrizePayload = {
  ok: boolean;
  prizeLabel?: string;
  rarity?: 'common' | 'rare' | 'ultra' | null;
  nextPlayableAt?: number | null;
  error?: string;
};

function emitPrize(label: string, rarity: PrizePayload['rarity']) {
  // Uses the global modal host we added earlier
  window.dispatchEvent(
    new CustomEvent('prize:show', {
      detail: { label, type: 'crate', rarity },
    })
  );
}

export default function Shuffle() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [positions, setPositions] = useState<number[]>([0, 1, 2]); // egg index -> slot index
  const [slotXs, setSlotXs] = useState<number[]>([0, 0, 0]);

  const sceneRef = useRef<HTMLDivElement | null>(null);
  const swapTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const progTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Lay out three even slots based on scene width
  useEffect(() => {
    function layout() {
      const el = sceneRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const card = 120; // px width of an egg card
      const pad = 24;
      const usable = w - pad * 2;
      const gap = (usable - card * 3) / 2;
      const start = pad + card / 2;
      setSlotXs([start, start + card + gap, start + (card + gap) * 2]);
    }
    layout();
    const onR = () => layout();
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  // Start shuffle
  async function start() {
    if (phase !== 'idle') return;
    setPhase('shuffling');
    setProgress(0);

    // randomize starting mapping
    setPositions([0, 1, 2].sort(() => Math.random() - 0.5));

    // Drive the progress bar
    progTimer.current && clearInterval(progTimer.current);
    progTimer.current = setInterval(() => {
      setProgress((p) => Math.min(99, p + 3));
    }, 60);

    // Do N random swaps with easing-ish cadence
    let swapsLeft = 22 + Math.floor(Math.random() * 10); // 22–31 swaps
    let speed = 140; // ms between swaps at start
    swapTimer.current && clearInterval(swapTimer.current);

    const doSwap = () => {
      setPositions((prev) => {
        const a = Math.floor(Math.random() * 3);
        let b = Math.floor(Math.random() * 3);
        if (b === a) b = (b + 1) % 3;
        const next = [...prev];
        const ai = next.indexOf(a);
        const bi = next.indexOf(b);
        // swap the slot indexes of eggs a and b
        [next[ai], next[bi]] = [next[bi], next[ai]];
        return next;
      });

      swapsLeft--;
      // accelerate then decelerate: shorten then lengthen
      if (swapsLeft > 12) speed = Math.max(70, speed - 6);
      else speed = Math.min(220, speed + 14);

      if (swapsLeft <= 0) {
        // stop
        if (swapTimer.current) clearInterval(swapTimer.current);
        if (progTimer.current) {
          clearInterval(progTimer.current);
          setProgress(100);
        }
        setTimeout(() => setPhase('pick'), 200);
      } else {
        // reschedule next swap with new speed
        if (swapTimer.current) clearInterval(swapTimer.current);
        swapTimer.current = setInterval(doSwap, speed);
      }
    };

    swapTimer.current = setInterval(doSwap, speed);
  }

  async function pick(slotChosen: number) {
    if (phase !== 'pick') return;
    setPhase('reveal');

    try {
      // Let the API decide the prize. We only animate/host visuals here.
      const r = await fetch('/api/spin', { method: 'POST' });
      const data: PrizePayload = await r.json();

      const label =
        data.prizeLabel ??
        (data.rarity ? `${data.rarity[0].toUpperCase()}${data.rarity.slice(1)} Loot Crate` : 'Nothing this time');

      emitPrize(label, data.rarity ?? null);
    } catch (e) {
      emitPrize('Nothing this time', null);
    } finally {
      // Cooldown tiny pause so players see the layout reset
      setTimeout(() => {
        setPositions([0, 1, 2]);
        setProgress(0);
        setPhase('idle');
      }, 500);
    }
  }

  // convenience lookups: egg index -> x
  const eggTransforms = useMemo(() => {
    return positions.map((slotIdx) => {
      const x = slotXs[slotIdx] ?? 0;
      return `translate3d(${x}px,0,0)`;
    });
  }, [positions, slotXs]);

  const interactive = phase === 'pick';

  return (
    <div className="ant-card">
      <div className="shuffle-scene" ref={sceneRef}>
        {/* light sweeps */}
        <div className={`sweep ${phase === 'shuffling' ? 'run' : ''}`} />
        <div className={`sweep delay ${phase === 'shuffling' ? 'run' : ''}`} />

        {/* eggs */}
        {[0, 1, 2].map((eggIdx) => (
          <button
            key={eggIdx}
            className={`egg-card ${interactive ? 'can-pick' : ''}`}
            style={{ transform: eggTransforms[eggIdx] }}
            disabled={!interactive}
            onClick={() => pick(positions[eggIdx])}
          >
            <div className="egg-body">
              <div className="egg-gloss" />
              <div className="egg-speckle" />
            </div>
          </button>
        ))}

        {/* progress rail */}
        <div className="rail">
          <div className="rail-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="mt-4">
        <button
          onClick={start}
          disabled={phase !== 'idle'}
          className="btn"
          aria-busy={phase !== 'idle'}
        >
          {phase === 'idle' ? 'Shuffle' : 'Shuffling…'}
        </button>
      </div>
    </div>
  );
}
