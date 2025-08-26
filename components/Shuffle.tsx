import React, { useEffect, useMemo, useRef, useState } from 'react';

type Phase = 'idle' | 'shuffling' | 'pick' | 'reveal';
type Rarity = 'common' | 'rare' | 'ultra' | null;

type PrizePayload = {
  ok: boolean;
  prizeLabel?: string;
  rarity?: Rarity;
  nextPlayableAt?: number | null;
  error?: string;
};

function showPrize(label: string, rarity: Rarity) {
  // Fire the global modal event (PrizeModalHost listens for this)
  window.dispatchEvent(new CustomEvent('prize:show', { detail: { label, type: 'crate', rarity } }));
}

export default function Shuffle() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [positions, setPositions] = useState<number[]>([0, 1, 2]); // eggIdx -> slotIdx
  const [slotCenters, setSlotCenters] = useState<number[]>([0, 0, 0]); // px center of each slot

  const sceneRef = useRef<HTMLDivElement | null>(null);
  const swapTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const progTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Layout three evenly spaced centers inside the scene
  useEffect(() => {
    const layout = () => {
      const el = sceneRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const cardW = 120;
      const sidePad = 32;
      const usable = Math.max(0, w - sidePad * 2);
      const gap = (usable - cardW * 3) / 2;
      const firstCenter = sidePad + cardW / 2;
      setSlotCenters([firstCenter, firstCenter + cardW + gap, firstCenter + (cardW + gap) * 2]);
    };
    layout();
    const onR = () => layout();
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  // Start shuffle
  function start() {
    if (phase !== 'idle') return;
    setPhase('shuffling');
    setProgress(0);

    // randomize starting order
    setPositions([0, 1, 2].sort(() => Math.random() - 0.5));

    // progress driver
    progTimer.current && clearInterval(progTimer.current);
    progTimer.current = setInterval(() => setProgress((p) => Math.min(99, p + 3)), 60);

    // do a bunch of swaps with accel/decel
    let swapsLeft = 22 + Math.floor(Math.random() * 10);
    let speed = 140;

    const swapOnce = () => {
      setPositions((prev) => {
        const a = Math.floor(Math.random() * 3);
        let b = Math.floor(Math.random() * 3);
        if (b === a) b = (b + 1) % 3;

        const next = [...prev];
        const ai = next.indexOf(a);
        const bi = next.indexOf(b);
        [next[ai], next[bi]] = [next[bi], next[ai]];
        return next;
      });

      swapsLeft--;
      if (swapsLeft > 12) speed = Math.max(70, speed - 6); // accelerate
      else speed = Math.min(220, speed + 14);             // decelerate

      if (swapsLeft <= 0) {
        if (swapTimer.current) clearInterval(swapTimer.current);
        if (progTimer.current) {
          clearInterval(progTimer.current);
          setProgress(100);
        }
        setTimeout(() => setPhase('pick'), 200);
      } else {
        if (swapTimer.current) clearInterval(swapTimer.current);
        swapTimer.current = setInterval(swapOnce, speed);
      }
    };

    swapTimer.current = setInterval(swapOnce, speed);
  }

  async function pick(slotChosen: number) {
    if (phase !== 'pick') return;
    setPhase('reveal');
    try {
      const r = await fetch('/api/spin', { method: 'POST' });
      const data: PrizePayload = await r.json();
      const label =
        data.prizeLabel ??
        (data.rarity ? `${data.rarity[0].toUpperCase()}${data.rarity.slice(1)} Loot Crate` : 'Nothing this time');
      showPrize(label, data.rarity ?? null);
    } catch {
      showPrize('Nothing this time', null);
    } finally {
      setTimeout(() => {
        setPositions([0, 1, 2]);
        setProgress(0);
        setPhase('idle');
      }, 500);
    }
  }

  // compute transforms; subtract half card width so centers align
  const cardW = 120;
  const eggTransforms = useMemo(() => {
    return positions.map((slotIdx) => {
      const cx = slotCenters[slotIdx] ?? 0;
      const left = cx - cardW / 2;
      return `translate3d(${left}px,0,0)`;
    });
  }, [positions, slotCenters]);

  const canPick = phase === 'pick';

  return (
    <div className="ant-card">
      <div className="shuffle-scene" ref={sceneRef}>
        <div className={`sweep ${phase === 'shuffling' ? 'run' : ''}`} />
        <div className={`sweep delay ${phase === 'shuffling' ? 'run' : ''}`} />

        {[0, 1, 2].map((eggIdx) => (
          <button
            key={eggIdx}
            className={`egg-card ${canPick ? 'can-pick' : ''}`}
            style={{ transform: eggTransforms[eggIdx] }}
            disabled={!canPick}
            onClick={() => pick(positions[eggIdx])}
            aria-label="Pick this egg"
          >
            <div className="egg-body always-wobble">
              <div className="egg-gloss" />
              <div className="egg-speckle" />
            </div>
          </button>
        ))}

        <div className="rail"><div className="rail-fill" style={{ width: `${progress}%` }} /></div>
      </div>

      <div className="mt-4">
        <button onClick={start} disabled={phase !== 'idle'} className="btn" aria-busy={phase !== 'idle'}>
          {phase === 'idle' ? 'Shuffle' : 'Shuffling…'}
        </button>
      </div>
    </div>
  );
}
