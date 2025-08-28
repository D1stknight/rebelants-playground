// components/Shuffle.tsx
'use client';

import React, { useMemo, useState, useMemo as _useMemo } from 'react';
import dynamic from 'next/dynamic';
const Queen3D = dynamic(() => import('@/components/Queen3D'), { ssr: false });

type Phase = 'idle' | 'shuffling' | 'pick' | 'revealed';
type Rarity = 'none' | 'common' | 'rare' | 'ultra';

const LANES = [21.5, 50, 78.5] as const;

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
  const [order, setOrder] = useState<[number, number, number]>([0, 1, 2]);

  const ctaDisabled = busy || phase === 'shuffling';
  const lanes = useMemo(() => LANES, []);

  // 40% none, 40% common, 18% rare, 2% ultra
  const rollPrize = (): Rarity => {
    const r = Math.random();
    if (r < 0.4) return 'none';
    if (r < 0.8) return 'common';
    if (r < 0.98) return 'rare';
    return 'ultra';
  };

  async function runShuffle() {
    if (busy) return;
    setBusy(true);
    setPhase('shuffling');
    setProgress(0);
    setOrder([0, 1, 2]);

    const steps = 12 + Math.floor(Math.random() * 6);
    for (let i = 0; i < steps; i++) {
      setOrder((prev) => {
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

  function onPick() {
    if (phase !== 'pick' || busy) return;
    setBusy(true);
    setPhase('revealed');
    setBusy(false);
    const r = rollPrize();
    setPrize(r);
    setShowPrize(true);
  }

  // Prize state
  const [showPrize, setShowPrize] = useState(false);
  const [prize, setPrize] = useState<Rarity>('none');

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

        {/* Queen in background */}
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
          {phase === 'idle' || phase === 'revealed' ? 'Shuffle' : 'Shuffling…'}
        </button>
      </div>

      {/* Prize modal */}
      {showPrize && (
        <PrizeModal
          rarity={prize}
          onClose={() => setShowPrize(false)}
        />
      )}
    </div>
  );
}

/* ===================== Prize Modal ===================== */

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

  // put rarity class on the WRAPPER (this matches your CSS)
  const wrapperCls =
    rarity === 'ultra'
      ? 'pm-ultra'
      : rarity === 'rare'
      ? 'pm-rare'
      : rarity === 'common'
      ? 'pm-common'
      : 'pm-none';

  return (
    <div className={`prize-modal ${wrapperCls}`} onClick={onClose}>
      <div className="prize-card pop-in" onClick={(e) => e.stopPropagation()}>
        {/* Rarity aura */}
        <div className="prize-aura" data-rarity={rarity} />

        {/* Sparkles for wins */}
        {rarity !== 'none' && <Sparkles rarity={rarity} />}

        {rarity === 'none' ? (
          <div className="prize-crate" />
        ) : (
          <img
            src={
              rarity === 'ultra'
                ? PRIZE_IMG.ultra
                : rarity === 'rare'
                ? PRIZE_IMG.rare
                : PRIZE_IMG.common
            }
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

/* ===================== Sparkles ===================== */

function Sparkles({ rarity, count = 12 }: { rarity: Exclude<Rarity, 'none'>; count?: number }) {
  const cls =
    rarity === 'ultra' ? 'sparkle-ultra' : rarity === 'rare' ? 'sparkle-rare' : 'sparkle-common';

  // stable random positions for the life of the modal
  const dots = _useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => {
        const left = 10 + Math.random() * 80; // %
        const top = 6 + Math.random() * 44;   // %
        const delay = (Math.random() * 0.6).toFixed(2); // seconds
        return { id: i, left, top, delay };
      }),
    [count]
  );

  return (
    <>
      {dots.map(({ id, left, top, delay }) => (
        <span
          key={id}
          className={`sparkle ${cls} animate`}
          style={{
            left: `${left}%`,
            top: `${top}%`,
            position: 'absolute',
            animationDelay: `${delay}s`,
          }}
        />
      ))}
    </>
  );
}
