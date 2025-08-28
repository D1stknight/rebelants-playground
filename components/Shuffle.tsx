// components/Shuffle.tsx
// RA: Shuffle v1.5 — FIX: correct positioning (lanes[order[i]]), clean phases, prize event

import React, { useEffect, useMemo, useState } from 'react';
import Queen from '@/components/Queen';


type Phase = 'idle' | 'shuffling' | 'pick' | 'revealed';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function Shuffle() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  // order[i] = lane index (0..2) where card i should sit
  const [order, setOrder] = useState<number[]>([0, 1, 2]);

// centered over the inner 86% strip: 7% + 86% * (1/6, 3/6, 5/6)
const lanes = useMemo(() => [21.5, 50, 78.5], []);

  useEffect(() => {
    setPhase('idle');
    setBusy(false);
    setProgress(0);
    setOrder([0, 1, 2]);
  }, []);

  async function runShuffle() {
    if (busy) return;
    setBusy(true);
    setPhase('shuffling');
    setProgress(0);

    // 22–28 swaps with easing
    const swaps = 22 + Math.floor(Math.random() * 7);
    for (let i = 0; i < swaps; i++) {
      setOrder(prev => {
        const next = [...prev];
        let a = Math.floor(Math.random() * 3);
        let b = Math.floor(Math.random() * 3);
        while (b === a) b = Math.floor(Math.random() * 3);
        [next[a], next[b]] = [next[b], next[a]];
        return next;
      });
      const t = i / swaps;
      const dur = 80 + Math.floor(220 * (t * t)); // ease-in
      // eslint-disable-next-line no-await-in-loop
      await wait(dur);
      setProgress(Math.min(99, Math.floor((i / (swaps - 1)) * 100)));
    }

    setProgress(100);
    setPhase('pick');
    setBusy(false);
  }

  async function onPick() {
    if (busy || phase !== 'pick') return;
    setBusy(true);

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
    // soft reset so CTA comes back to Shuffle
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

  const ctaDisabled = phase === 'shuffling' || busy;

  return (
    <div className="ant-card ra-shuffle2">
      <div className="title">Queen&apos;s Egg Shuffle</div>
      <p className="subtitle">Three eggs. We shuffle. You pick one for a prize.</p>

      {/* Safety CTA pinned in-scene */}
      <button
        className="btn ra-safety"
        disabled={ctaDisabled || phase === 'pick'}
        onClick={() => (phase === 'idle' || phase === 'revealed') && runShuffle()}
      >
        Shuffle
      </button>

      {/* Scene */}
<div className="shuffle-scene ant-scene">
  <div className="strip" />

  {/* Queen (behind eggs). Glows while shuffling */}
  <Queen className={`queen ${phase === 'shuffling' ? 'is-active' : ''}`} aria-hidden="true" />

  <div className="rail rail-top" />
  <div className="rail rail-bottom" />

  {/* Progress */}
  <div className="shuffle-progress">
    <div style={{ width: `${progress}%` }} />
  </div>

  {/* Render fixed cards [0,1,2]; position by lanes[order[i]] */}
  {[0, 1, 2].map((i) => (
    <button
      key={i}
      className={`egg-card ${phase === 'pick' ? 'can-pick' : ''}`}
      style={{ left: `${lanes[order[i]]}%`, top: '58%' }}
      onClick={onPick}
      disabled={phase !== 'pick' || busy}
      aria-label="Pick egg"
    >
      <div className={`egg-body ${phase === 'pick' ? 'wobble-on-pick' : ''}`} />
      <div className="egg-shadow" />
      <div className="egg-speckle" />
    </button>
  ))}
</div>

      {/* Normal CTA below scene */}
      <div className="shuffle-cta">
        <button
          className="btn"
          disabled={ctaDisabled || phase === 'pick'}
          onClick={() => (phase === 'idle' || phase === 'revealed') && runShuffle()}
        >
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}
