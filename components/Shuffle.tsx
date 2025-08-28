// components/Shuffle.tsx
import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

// 3D queen (client-only)
const Queen3D = dynamic(() => import('./Queen3D'), {
  ssr: false,
}) as React.ComponentType<{ active?: boolean; scale?: number; y?: number }>;

type Phase = 'idle' | 'shuffling' | 'pick' | 'revealed';
type Rarity = 'none' | 'common' | 'rare' | 'ultra';

const LANES = [21.5, 50, 78.5];         // left:% for the three lanes
const SHUFFLE_MS = 3200;                // ⏱ total shuffle duration (slower now)
const SWAP_EVERY_MS = 280;              // do lots of swaps during the shuffle

/* ------------ helper: random rarity -------------- */
function rollRarity(): Rarity {
  const r = Math.random();
  if (r < 0.05) return 'ultra';   // 5%
  if (r < 0.18) return 'rare';    // 13%
  if (r < 0.55) return 'common';  // 37%
  return 'none';                  // 45%
}

/* ------------ helper: fisher–yates --------------- */
function shuffled3(): number[] {
  const arr = [0, 1, 2];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ------------ tiny marching ant icon -------------- */
function AntIcon() {
  return (
    <svg viewBox="0 0 24 12" aria-hidden="true">
      <circle cx="8" cy="6" r="3.2" />
      <circle cx="14" cy="6" r="2.4" />
      <circle cx="19" cy="6" r="2.1" />
      <line x1="14" y1="4.4" x2="11" y2="2.4" />
      <line x1="14" y1="7.6" x2="11" y2="9.6" />
      <line x1="19" y1="4.4" x2="22" y2="2.4" />
      <line x1="19" y1="7.6" x2="22" y2="9.6" />
      <style jsx>{`
        svg { width: 16px; height: 16px; }
        circle, line { stroke: none; fill: #a7f3d0; }
        line { stroke: #a7f3d0; stroke-width: 1.2; stroke-linecap: round; fill: none; }
      `}</style>
    </svg>
  );
}

/* ------------ progress with marching ants --------- */
function AntProgress({ progress }: { progress: number }) {
  const ants = useMemo(() => Array.from({ length: 8 }, (_, i) => i), []);
  return (
    <div className="ant-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
      <div className="track" />
      {ants.map((i) => (
        <div key={i} className="ant" style={{ left: `calc(${progress}% - ${i * 16}px)` }}>
          <AntIcon />
        </div>
      ))}
      <style jsx>{`
        .ant-progress {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          bottom: 14px;
          width: 90%;
          height: 22px;
          pointer-events: none;
          z-index: 26;
        }
        .track {
          position: absolute; left: 0; right: 0;
          top: 50%; height: 7px; transform: translateY(-50%);
          border-radius: 999px;
          background: linear-gradient(90deg, #2e3b54, #335a64);
          box-shadow: inset 0 2px 6px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.06);
          opacity: .85;
        }
        .ant {
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          filter: drop-shadow(0 0 6px rgba(0,255,170,.28));
          animation: antBob .58s ease-in-out infinite;
        }
        .ant:nth-child(2n) { animation-duration: .66s; }
        @keyframes antBob {
          0%,100% { transform: translate(-50%, -50%) }
          50%     { transform: translate(-50%, -56%) }
        }
      `}</style>
    </div>
  );
}

/* -------- local prize modal (uses your CSS classes) -------- */
function PrizeModal({
  rarity,
  onClose,
}: {
  rarity: Rarity;
  onClose: () => void;
}) {
  const title =
    rarity === 'ultra' ? 'ULTRA CRATE!'
    : rarity === 'rare' ? 'Rare Crate!'
    : rarity === 'common' ? 'Crate Unlocked'
    : 'No crate this time';

  return (
    <div className="prize-modal" role="dialog" aria-modal="true">
      <div className={`prize-card pm-${rarity}`}>
        <div className="prize-title">{title}</div>
        {rarity !== 'none' ? (
          <>
            <div className="prize-aura" data-rarity={rarity} />
            <img className="prize-art" src={`/crates/${rarity}.png`} alt={`${rarity} crate`} />
            <div className="prize-sub">Tap continue to play again.</div>
          </>
        ) : (
          <div className="prize-sub" style={{ marginBottom: 12 }}>
            Bummer! Try another egg.
          </div>
        )}
        <button className="btn" onClick={onClose}>Continue</button>
      </div>
    </div>
  );
}

/* ===================== main game ====================== */
export default function Shuffle() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [order, setOrder] = useState<number[]>([0, 1, 2]);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [rarity, setRarity] = useState<Rarity>('none');
  const [showPrize, setShowPrize] = useState(false);

  const runShuffle = () => {
    if (busy) return;
    setBusy(true);
    setPhase('shuffling');
    setProgress(0);
    setShowPrize(false);

    // multiple swaps during the shuffle window
    let swapTimer: NodeJS.Timeout | null = null;
    swapTimer = setInterval(() => setOrder(shuffled3()), SWAP_EVERY_MS);

    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / SHUFFLE_MS);
      setProgress(Math.floor(p * 100));
      if (p < 1) requestAnimationFrame(tick);
      else {
        if (swapTimer) clearInterval(swapTimer);
        setPhase('pick');
        setBusy(false);
      }
    };
    requestAnimationFrame(tick);
  };

  const onPick = () => {
    if (phase !== 'pick' || busy) return;
    setBusy(true);
    // tiny pause for click feedback, then "reveal"
    setTimeout(() => {
      const r = rollRarity();
      setRarity(r);
      setPhase('revealed');
      setShowPrize(true);
      setBusy(false);
    }, 350);
  };

  const resetAfterPrize = () => {
    setShowPrize(false);
    setRarity('none');
    setProgress(0);
    setOrder([0, 1, 2]);
    setPhase('idle');
  };

  return (
    <div className="ant-card ra-shuffle2">
      <div className="title">Queen&apos;s Egg Shuffle</div>
      <p className="subtitle">Three eggs. We shuffle. You pick one for a prize.</p>

      {/* Scene */}
      <div className="shuffle-scene ant-scene" style={{ position: 'relative' }}>
        <div className="strip" />

        {/* 3D Queen — scale 0.9 like you asked */}
        <Queen3D active={phase === 'shuffling'} scale={0.9} y={0} />

        <div className="rail rail-top" />
        <div className="rail rail-bottom" />

        {/* marching-ants progress (slower) */}
        <AntProgress progress={phase === 'shuffling' ? progress : 0} />

        {/* Eggs */}
        {[0, 1, 2].map((i) => (
          <button
            key={i}
            className={`egg-card ${phase === 'pick' ? 'can-pick' : ''}`}
            style={{ left: `${LANES[order[i]]}%`, top: '58%' }}
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

      {/* CTA below scene */}
      <div className="shuffle-cta">
        <button className="btn" onClick={runShuffle} disabled={busy || phase === 'shuffling'}>
          {phase === 'shuffling' ? 'Shuffling…' : 'Shuffle'}
        </button>
      </div>

      {/* Prize modal (uses your existing global CSS look) */}
      {showPrize && <PrizeModal rarity={rarity} onClose={resetAfterPrize} />}
    </div>
  );
}
