// RA: Shuffle v1.2 (2025-08-26)
// - Restores CTA visibility and shuffling
// - Keeps eggs centered via translateX(-50%)
// - Emits 'rebelants:prize' on pick

import React, { useEffect, useMemo, useState } from 'react';

type Phase = 'idle' | 'shuffling' | 'pick' | 'revealed';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function Shuffle() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [order, setOrder] = useState<number[]>([0, 1, 2]); // visual order
  const [canPick, setCanPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  // lanes are centered by translateX(-50%)
  const lanes = useMemo(() => [18, 50, 82], []);

  useEffect(() => {
    setPhase('idle');
    setCanPick(false);
    setProgress(0);
  }, []);

  async function runShuffle() {
    if (busy) return;
    setBusy(true);
    setCanPick(false);
    setPhase('shuffling');
    setProgress(0);

    const swaps = 22 + Math.floor(Math.random() * 7);
    for (let i = 0; i < swaps; i++) {
      setOrder(prev => {
        let a = Math.floor(Math.random() * 3);
        let b = Math.floor(Math.random() * 3);
        while (b === a) b = Math.floor(Math.random() * 3);
        const next = [...prev];
        [next[a], next[b]] = [next[b], next[a]];
        return next;
      });
      const t = i / (swaps - 1);
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      setProgress(Math.min(99, Math.floor(eased * 100)));
      // eslint-disable-next-line no-await-in-loop
      await wait(120 + Math.floor(140 * eased));
    }

    setProgress(100);
    setPhase('pick');
    setCanPick(true);
    setBusy(false);
  }

  async function onPick() {
    if (!canPick || busy || phase !== 'pick') return;
    setBusy(true);
    setCanPick(false);

    try {
      const res = await fetch('/api/spin', { method: 'POST' });
      const data = await res.json();
      window.dispatchEvent(
        new CustomEvent('rebelants:prize', {
          detail: {
            label: data?.prizeLabel ?? 'Nothing this time',
            type: data?.type ?? 'none',
            rarity: data?.rarity ?? null,
            sub: data?.sub ?? undefined,
          },
        }),
      );
    } catch {
      window.dispatchEvent(
        new CustomEvent('rebelants:prize', {
          detail: { label: 'Nothing this time', type: 'none', rarity: null },
        }),
      );
    }

    setPhase('revealed');
    setTimeout(() => {
      setPhase('idle');
      setProgress(0);
      setBusy(false);
    }, 800);
  }

  const ctaLabel =
    phase === 'idle' || phase === 'revealed'
      ? 'Shuffle'
      : phase === 'shuffling'
      ? 'Shuffling…'
      : 'Pick an egg';

  const ctaDisabled = phase === 'shuffling' || phase === 'pick' || busy;

  return (
    <div className="ant-card">
      <div className="title">Queen&apos;s Egg Shuffle</div>
      <p className="subtitle">Three eggs. We shuffle. You pick one for a prize.</p>

      <div className="shuffle-wrap">
        {/* Scene */}
        <div className="shuffle-scene ant-scene">
          <div className="strip" />
          <div className="rail rail-top" />
          <div className="rail rail-bottom" />

          {order.map((eggId, pos) => (
            <button
              key={eggId}
              className={`egg-card ${canPick ? 'can-pick' : ''}`}
              style={{
                left: `${lanes[pos]}%`,
                transform: 'translateX(-50%)',
                top: '58%',
              }}
              onClick={onPick}
              disabled={!canPick || busy}
              aria-label="Pick egg"
            >
              <div className={`egg-body ${canPick ? 'always-wobble' : ''}`} />
              <div className="egg-shadow" />
              <div className="egg-speckle" />
            </button>
          ))}
        </div>

        {/* Progress */}
        <div className="shuffle-progress">
          <div className="bar">
            <div className="fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* CTA – visible & clickable */}
        <div className="shuffle-cta">
          <button
            className="btn"
            disabled={ctaDisabled}
            onClick={() => {
              if (phase === 'idle' || phase === 'revealed') runShuffle();
            }}
          >
            {ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
