// components/Shuffle.tsx
// RA: Shuffle v1.4 — button pinned, centered lanes, wobble-on-pick, prize modal event

import React, { useEffect, useMemo, useState } from 'react';

type Phase = 'idle' | 'shuffling' | 'pick' | 'revealed';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function Shuffle() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [order, setOrder] = useState<number[]>([0, 1, 2]);
  const [canPick, setCanPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  // lanes are x-positions as percentages; CSS will center via translateX(-50%)
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

    const swaps = 22 + Math.floor(Math.random() * 7); // 22–28 swaps
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
      const eased = t < 0.6 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInQuad → easeOutQuad
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
        })
      );
    } catch {
      window.dispatchEvent(
        new CustomEvent('rebelants:prize', {
          detail: { label: 'Nothing this time', type: 'none', rarity: null },
        })
      );
    }

    setPhase('revealed');
    await wait(350);
    setBusy(false);
  }

  const ctaBelow =
    phase === 'idle' || phase === 'revealed'
      ? 'Shuffle'
      : phase === 'shuffling'
      ? 'Shuffling…'
      : 'Pick an egg';

  const disableCtaBelow = phase === 'shuffling' || phase === 'pick' || busy;

  return (
    <div className="ant-card ra-shuffle">
      <div className="title">Queen&apos;s Egg Shuffle</div>
      <p className="subtitle">Three eggs. We shuffle. You pick one for a prize.</p>

      {/* SAFETY CTA pinned inside scene so it never “disappears” */}
      <button
        className="btn btn-safety"
        onClick={() => {
          if (phase === 'idle' || phase === 'revealed') runShuffle();
        }}
        disabled={phase === 'shuffling' || phase === 'pick' || busy}
      >
        Shuffle
      </button>

      {/* Scene */}
      <div className="shuffle-scene ant-scene">
        <div className="strip" />
        <div className="rail rail-top" />
        <div className="rail rail-bottom" />

        {/* Progress */}
        <div className="shuffle-progress">
          <div className="bar" style={{ width: `${progress}%` }} />
        </div>

        {/* Eggs */}
        {order.map((eggId, pos) => (
          <button
            key={eggId}
            className={`egg-card ${canPick ? 'can-pick' : ''}`}
            style={{ left: `${lanes[pos]}%`, top: '56%' }}
            onClick={onPick}
            disabled={!canPick || busy}
            aria-label="Pick egg"
          >
            <div className={`egg-body ${canPick ? 'wobble-on-pick' : ''}`} />
            <div className="egg-shadow" />
            <div className="egg-speckle" />
          </button>
        ))}
      </div>

      {/* Normal CTA under the scene (nice UX) */}
      <div className="shuffle-cta">
        <button
          className="btn"
          disabled={disableCtaBelow}
          onClick={() => {
            if (phase === 'idle' || phase === 'revealed') runShuffle();
          }}
        >
          {ctaBelow}
        </button>
      </div>
    </div>
  );
}
