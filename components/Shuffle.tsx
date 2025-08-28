// components/Shuffle.tsx
'use client';

import React, { useMemo, useState } from 'react';
import Queen from './Queen';

type Phase = 'idle' | 'shuffling' | 'pick' | 'revealed';
type Rarity = 'none' | 'common' | 'rare' | 'ultra';

const LANES = [21.5, 50, 78.5] as const;

// Use YOUR existing images under /public/crates
const PRIZE_IMG: Record<Exclude<Rarity, 'none'>, string> = {
  common: '/crates/common.png',
  rare: '/crates/rare.png',
  ultra: '/crates/ultra.png',
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Shuffle() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  // order[i] = which lane index the i-th card sits in (0..2)
  const [order, setOrder] = useState<[number, number, number]>([0, 1, 2]);

  const ctaDisabled = busy || phase === 'shuffling';

  // probability: 40% none, 40% common, 18% rare, 2% ultra
  const rollPrize = (): Rarity => {
    const r = Math.random();
    if (r < 0.40) return 'none';
    if (r < 0.80) return 'common';
    if (r < 0.98) return 'rare';
    return 'ultra';
  };

  const lanes = useMemo(() => LANES, []);

  async function runShuffle() {
    if (busy) return;
    setBusy(true);
    setPhase('shuffling');
    setProgress(0);

    // reset to canonical positions before shuffling
    setOrder([0, 1, 2]);

    const steps = 12 + Math.floor(Math.random() * 6); // 12..17 swaps
    for (let i = 0; i < steps; i++) {
      setOrder((prev) => {
        // swap two distinct indices
        let a = Math.floor(Math.random() * 3);
        let b = Math.floor(Math.random() * 3);
        while (b === a) b = Math.floor(Math.random() * 3);
        const next = [...prev] as [number, number, number];
        [next[a], next[b]] = [next[b], next[a]];
        return next;
      });
      setProgress(Math.round(((i + 1) / steps) * 100));
      await wait(140);
    }

    setBusy(false);
    setPhase('pick');
  }

  function handlePick() {
    if (phase !== 'pick' || busy) return;
    setBusy(true);
    setPhase('revealed');
    setBusy(false);

    const r = rollPrize();
    setPrize(r);
    setShowPrize(true);
  }

  // ------- Prize modal state -------
  const [showPrize, setShowPrize] = useState(false);
  const [prize, setPrize] = useState<Rarity>('none');

  function closePrize() {
    setShowPrize(false);
  }

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

      {/* ===== Scene ===== */}
      <div className="shuffle-scene ant-scene">
        <div className="strip" />

        {/* ONE queen only (SVG). Delete any extra <div className="queen" /> in your file. */}
        <Queen className={`queen ${phase === 'shuffling' ? 'is-active' : ''}`} />

        <div className="rail rail-top" />
        <div className="rail rail-bottom" />

        {/* Progress */}
        <div className="shuffle-progress">
          <div style={{ width: `${progress}%` }} />
        </div>

        {/* Eggs – fixed cards [0,1,2]; position by lanes[order[i]] */}
        {[0, 1, 2].map((i) => (
          <button
            key={i}
            className={`egg-card ${phase === 'pick' ? 'can-pick' : ''}`}
            style={{ left: `${lanes[order[i]]}%`, top: '58%' }}
            onClick={handlePick}
            disabled={phase !== 'pick' || busy}
            aria-label="Pick egg"
          >
            <div className={`egg-body ${phase === 'pick' ? 'wobble-on-pick' : ''}`} />
            <div className="egg-shadow" />
            <div className="egg-speckle" />
          </button>
        ))}
      </div>

      {/* Bottom CTA */}
      <div className="shuffle-cta">
        <button
          className="btn"
          disabled={ctaDisabled || phase === 'pick'}
          onClick={() => (phase === 'idle' || phase === 'revealed') && runShuffle()}
        >
          {phase === 'idle' || phase === 'revealed' ? 'Shuffle' : 'Shuffling…'}
        </button>
      </div>

      {/* Prize modal */}
      {showPrize && (
        <PrizeModal
          rarity={prize}
          onClose={closePrize}
        />
      )}
    </div>
  );
}

/* ===================== Prize Modal (inline) ===================== */

function PrizeModal({
  rarity,
  onClose,
}: {
  rarity: Rarity;
  onClose: () => void;
}) {
  const title =
    rarity === 'ultra'
      ? 'Ultra Crate!'
      : rarity === 'rare'
      ? 'Rare Crate!'
      : rarity === 'common'
      ? 'Common Crate'
      : 'No prize this time';

  const sub =
    rarity === 'none'
      ? 'The Queen is amused. Try again!'
      : 'Tap Continue to claim and play again.';

  const cardCls =
    rarity === 'ultra'
      ? 'pm-ultra'
      : rarity === 'rare'
      ? 'pm-rare'
      : rarity === 'common'
      ? 'pm-common'
      : 'pm-none';

  return (
    <div className="prize-modal" onClick={onClose}>
      <div className={`prize-card pop-in ${cardCls}`} onClick={(e) => e.stopPropagation()}>
        {/* Rarity aura (your CSS uses [data-rarity]) */}
        <div className="prize-aura" data-rarity={rarity} />

        {rarity === 'none' ? (
          // fallback shape is hidden in pm-none by your CSS, but this keeps layout stable
          <div className="prize-crate" />
        ) : (
          <img
            src={PRIZE_IMG[rarity]}
            alt={`${rarity} crate`}
            className="prize-art"
            draggable={false}
          />
        )}

        <div className="prize-title">{title}</div>
        <div className="prize-sub">{sub}</div>

        <button className="btn" onClick={onClose}>
          Continue
        </button>
      </div>
    </div>
  );
}
