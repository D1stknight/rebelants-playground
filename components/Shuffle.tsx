// components/Shuffle.tsx
import React, { useMemo, useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';

const Queen3D = dynamic(() => import('@/components/Queen3D'), { ssr: false });

type Phase = 'idle' | 'shuffling' | 'pick' | 'revealed';
type Rarity = 'none' | 'common' | 'rare' | 'ultra';

const LANES = [21.5, 50, 78.5]; // left:% for [0,1,2]

/* ---------- tiny ant icon (SVG) ---------- */
function AntIcon() {
  return (
    <svg viewBox="0 0 24 12" aria-hidden="true">
      {/* abdomen, thorax, head */}
      <circle cx="8" cy="6" r="3.2" />
      <circle cx="14" cy="6" r="2.4" />
      <circle cx="19" cy="6" r="2.1" />
      {/* legs + antenna */}
      <line x1="14" y1="4.4" x2="11" y2="2.4" />
      <line x1="14" y1="7.6" x2="11" y2="9.6" />
      <line x1="19" y1="4.4" x2="22" y2="2.4" />
      <line x1="19" y1="7.6" x2="22" y2="9.6" />
      <line x1="20.2" y1="4.8" x2="22.4" y2="1.8" />
      <style jsx>{`
        svg { width: 16px; height: 16px; }
        circle, line {
          stroke: none;
          fill: #a7f3d0;
        }
        line {
          stroke: #a7f3d0;
          stroke-width: 1.2;
          stroke-linecap: round;
          fill: none;
        }
      `}</style>
    </svg>
  );
}

/* ---------- marching-ants progress ---------- */
function AntProgress({ progress }: { progress: number }) {
  const ants = useMemo(() => Array.from({ length: 8 }, (_, i) => i), []);
  return (
    <div className="ant-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
      <div className="track" />
      {ants.map((i) => (
        <div
          key={i}
          className="ant"
          style={{ left: `calc(${progress}% - ${i * 16}px)` }}
        >
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
          z-index: 26; /* above rails, under eggs is fine */
        }
        .track {
          position: absolute;
          left: 0; right: 0;
          top: 50%;
          height: 7px;
          transform: translateY(-50%);
          border-radius: 999px;
          background: linear-gradient(90deg, #2e3b54, #335a64);
          box-shadow: inset 0 2px 6px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.06);
          opacity: .8;
        }
        .ant {
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          filter: drop-shadow(0 0 6px rgba(0,255,170,.28));
          animation: antBob .55s ease-in-out infinite;
        }
        .ant:nth-child(2n) { animation-duration: .62s; }
        @keyframes antBob {
          0%,100% { transform: translate(-50%, -50%) }
          50%     { transform: translate(-50%, -56%) }
        }
      `}</style>
    </div>
  );
}

/* ---------- main game ---------- */
export default function Shuffle() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [order, setOrder] = useState<number[]>([0, 1, 2]);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  // simple utility to shuffle [0,1,2]
  const shuffleOrder = () => {
    const arr = [0, 1, 2];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const runShuffle = () => {
    if (busy) return;
    setBusy(true);
    setPhase('shuffling');
    setOrder(shuffleOrder());
    setProgress(0);

    const start = performance.now();
    const DURATION = 1600; // ms
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / DURATION);
      setProgress(Math.floor(p * 100));
      if (p < 1) {
        requestAnimationFrame(tick);
      } else {
        setPhase('pick');
        setBusy(false);
      }
    };
    requestAnimationFrame(tick);
  };

  const onPick = () => {
    if (phase !== 'pick' || busy) return;
    setBusy(true);
    // simulate reveal delay then reset (you can open your PrizeModal here)
    setTimeout(() => {
      setPhase('revealed');
      setTimeout(() => {
        setProgress(0);
        setPhase('idle');
        setBusy(false);
      }, 1200);
    }, 400);
  };

  return (
    <div className="ant-card ra-shuffle2">
      <div className="title">Queen&apos;s Egg Shuffle</div>
      <p className="subtitle">Three eggs. We shuffle. You pick one for a prize.</p>

      {/* Scene */}
      <div className="shuffle-scene ant-scene" style={{ position: 'relative' }}>
        <div className="strip" />

        {/* 3D Queen (behind eggs) */}
        <Queen3D active={phase === 'shuffling'} />

        <div className="rail rail-top" />
        <div className="rail rail-bottom" />

        {/* marching-ants progress */}
        <AntProgress progress={progress} />

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

      {/* Normal CTA below scene */}
      <div className="shuffle-cta">
        <button className="btn" onClick={runShuffle} disabled={busy || phase === 'shuffling'}>
          {phase === 'shuffling' ? 'Shuffling…' : 'Shuffle'}
        </button>
      </div>

      {/* If you really want the pinned in-scene button, uncomment below and it will sit bottom-left inside the scene
      <button
        className="btn ra-safety"
        disabled={busy || phase === 'pick'}
        onClick={runShuffle}
      >
        Shuffle
      </button>
      */}

      <style jsx>{`
        /* Ensure the optional pinned button (if used) never overlaps the title */
        .ra-safety {
          position: absolute;
          left: 12px;
          bottom: 10px; /* bottom-left, not top-left */
          z-index: 28;
          padding: 6px 10px;
          font-size: 12px;
          border-radius: 8px;
          background: rgba(255,255,255,.08);
          border: 1px solid rgba(255,255,255,.15);
          backdrop-filter: blur(4px);
        }
      `}</style>
    </div>
  );
}
