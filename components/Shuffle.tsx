'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Queen from './Queen';

type Phase = 'idle' | 'shuffling' | 'pick' | 'revealed';
type Rarity = 'none' | 'common' | 'rare' | 'ultra';

export default function Shuffle() {
  // Lane centers that match your CSS rails (left:% positions)
  const lanes = useMemo(() => [21.5, 50, 78.5], []);
  const [order, setOrder] = useState<number[]>([0, 1, 2]);

  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  const [picked, setPicked] = useState<number | null>(null);
  const [prize, setPrize] = useState<Rarity | null>(null);
  const [showPrize, setShowPrize] = useState(false);

  const ctaDisabled = busy || phase === 'shuffling';

  // --- shuffle helpers -------------------------------------------------------

  function randomSwap(prev: number[]): number[] {
    const a = Math.floor(Math.random() * 3);
    let b = Math.floor(Math.random() * 3);
    if (a === b) b = (b + 1) % 3;
    const next = [...prev];
    [next[a], next[b]] = [next[b], next[a]];
    return next;
  }

  async function runShuffle() {
    if (busy) return;
    setBusy(true);
    setPicked(null);
    setPrize(null);
    setShowPrize(false);
    setOrder([0, 1, 2]);
    setPhase('shuffling');
    setProgress(0);

    const steps = 16;               // number of swaps
    const delay = 120;              // ms between swaps (~2s total)

    for (let s = 1; s <= steps; s++) {
      await new Promise((res) => setTimeout(res, delay));
      setOrder((cur) => randomSwap(cur));
      setProgress(Math.round((s / steps) * 100));
    }

    setPhase('pick');
    setBusy(false);
  }

  function weightedPrize(): Rarity {
    const r = Math.random();
    if (r < 0.60) return 'common';
    if (r < 0.90) return 'rare';
    if (r < 0.98) return 'ultra';
    return 'none';
  }

  async function onPick(i: number) {
    if (phase !== 'pick' || busy) return;
    setBusy(true);
    setPicked(i);
    setPhase('revealed');
    setProgress(100);

    // tiny delay for drama
    await new Promise((res) => setTimeout(res, 350));

    setPrize(weightedPrize());
    setShowPrize(true);
    setBusy(false);
  }

  // --- render ---------------------------------------------------------------

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

        {/* Queen behind the eggs; glows while shuffling */}
        <Queen className={`queen ${phase === 'shuffling' ? 'is-active' : ''}`} />

        <div className="rail rail-top" />
        <div className="rail rail-bottom" />

        {/* Progress */}
        <div className="shuffle-progress">
          <div style={{ width: `${progress}%` }} />
        </div>

        {/* Eggs */}
        {[0, 1, 2].map((i) => (
          <button
            key={i}
            className={`egg-card ${phase === 'pick' ? 'can-pick' : ''}`}
            style={{ left: `${lanes[order[i]]}%`, top: '58%' }}
            onClick={() => onPick(i)}
            disabled={phase !== 'pick' || busy}
            aria-label={`Pick egg ${i + 1}`}
          >
            <div className={`egg-body ${phase === 'pick' ? 'wobble-on-pick' : ''}`} />
            <div className="egg-shadow" />
            <div className="egg-speckle" />
          </button>
        ))}
      </div>

      {/* Normal CTA below scene */}
      <div className="shuffle-cta">
        <button className="btn" onClick={runShuffle} disabled={ctaDisabled}>
          {phase === 'pick' ? 'Shuffle again' : 'Shuffle'}
        </button>
      </div>

      {/* Prize modal */}
      {showPrize && prize && (
        <div
          className={`prize-modal ${
            prize === 'rare'
              ? 'pm-rare'
              : prize === 'ultra'
              ? 'pm-ultra'
              : prize === 'common'
              ? 'pm-common'
              : 'pm-none'
          }`}
        >
          <div className="prize-card pop-in">
            <div className="prize-title">You picked an egg!</div>
            <div className="prize-sub">
              {prize === 'common' && 'Common crate won 🎁'}
              {prize === 'rare' && 'Rare crate won 💎'}
              {prize === 'ultra' && 'Ultra crate won 👑'}
              {prize === 'none' && 'Better luck next time!'}
            </div>

            {/* Simple crate placeholder (styled by your CSS) */}
            <div className="prize-crate" />

            <button className="btn" onClick={() => setShowPrize(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
