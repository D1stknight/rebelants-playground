// components/Shuffle.tsx
import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

const Queen3D = dynamic(() => import('./Queen3D'), { ssr: false }) as React.ComponentType<{
  active?: boolean;
  scale?: number;
  y?: number;
}>;

type Phase = 'idle' | 'shuffling' | 'pick' | 'revealed';
type Rarity = 'none' | 'common' | 'rare' | 'ultra';

const LANES = [21.5, 50, 78.5];
const SHUFFLE_MS = 3200;
const SWAP_EVERY_MS = 280;

function rollRarity(): Rarity {
  const r = Math.random();
  if (r < 0.05) return 'ultra';
  if (r < 0.18) return 'rare';
  if (r < 0.55) return 'common';
  return 'none';
}
function shuffled3(): number[] {
  const a = [0, 1, 2];
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- Ant progress ---------- */
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
          width: 92%;
          height: 22px;
          pointer-events: none;
          z-index: 26;
        }
        .track {
          position: absolute; left: 0; right: 0; top: 50%;
          height: 7px; transform: translateY(-50%); border-radius: 999px;
          background:
            linear-gradient(90deg, rgba(255,255,255,.08) 0 2px, transparent 2px) repeat-x,
            linear-gradient(90deg, #22324a, #1a2a3f);
          background-size: 14px 7px, auto;
          box-shadow: inset 0 2px 6px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.06);
          opacity: .9;
        }
        .ant {
          position: absolute; top: 50%;
          transform: translate(-50%, -50%);
          filter: drop-shadow(0 0 7px rgba(0,255,170,.35));
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

/* ---------- Prize Modal (bright sparkles) ---------- */
function PrizeModal({ rarity, onClose }: { rarity: Rarity; onClose: () => void }) {
  const title =
    rarity === 'ultra' ? 'ULTRA CRATE!'
    : rarity === 'rare' ? 'Rare Crate!'
    : rarity === 'common' ? 'Crate Unlocked'
    : 'No crate this time';

  const sparks = useMemo(() => Array.from({ length: 24 }, (_, i) => ({
    left: `${8 + (i * 4.1) % 84}%`,
    top: `${10 + ((i * 7.3) % 62)}%`,
    size: 10 + ((i * 3) % 14),
    delay: (i * 0.18) % 3.2
  })), []);

  return (
    <div className="prize-modal" role="dialog" aria-modal="true">
      <div className={`prize-card pm-${rarity}`}>
        {rarity !== 'none' && (
          <div className="sparkle-layer" aria-hidden="true">
            {sparks.map((s, i) => (
              <span
                key={i}
                className={`pm-sparkle ${rarity}`}
                style={{ left: s.left, top: s.top, width: s.size, height: s.size, animationDelay: `${s.delay}s` }}
              />
            ))}
          </div>
        )}

        <div className="prize-title">{title}</div>

        {rarity !== 'none' ? (
          <>
            <div className="prize-aura" data-rarity={rarity} />
            <img className="prize-art" src={`/crates/${rarity}.png`} alt={`${rarity} crate`} />
            <div className="prize-sub">Tap continue to play again.</div>
          </>
        ) : (
          <div className="prize-sub" style={{ marginBottom: 12 }}>Bummer! Try another egg.</div>
        )}

        <button className="btn" onClick={onClose}>Continue</button>
      </div>

      <style jsx>{`
        .prize-modal { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.5); z-index: 1000; }
        .prize-card { position: relative; min-width: 320px; padding: 20px; border-radius: 12px; text-align: center;
          background: rgba(15,23,42,.95); border: 1px solid rgba(148,163,184,.25);
          box-shadow: 0 24px 40px rgba(0,0,0,.55); overflow: visible;
        }
        .prize-title { font-size: 18px; font-weight: 800; margin: 10px 0; }
        .prize-sub   { font-size: 14px; opacity: .85; margin-bottom: 12px; }
        .prize-art   { display: block; width: 240px; max-width: 80vw; height: auto; margin: 0 auto 12px; position: relative; z-index: 1; }

        .sparkle-layer { position: absolute; inset: -8% -10%; pointer-events: none; z-index: 0; }
        .pm-sparkle { position: absolute; border-radius: 50%;
          background: radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.0) 65%);
          filter: blur(.3px) drop-shadow(0 0 12px rgba(255,255,255,.65));
          opacity: 0; animation: pmSpark 2.6s ease-in-out infinite;
        }
        .pm-sparkle.common { filter: blur(.3px) drop-shadow(0 0 14px rgba(147,197,253,.85)); }
        .pm-sparkle.rare   { filter: blur(.3px) drop-shadow(0 0 14px rgba(59,130,246,.95)); }
        .pm-sparkle.ultra  { filter: blur(.3px) drop-shadow(0 0 16px rgba(244,63,94,1)); }
        @keyframes pmSpark {
          0%   { transform: scale(0.4); opacity: 0; }
          20%  { opacity: 1; }
          55%  { transform: scale(1.1); opacity: 0.9; }
          85%  { transform: scale(0.7); opacity: 0.7; }
          100% { transform: scale(0.3); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

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

    let swapTimer: NodeJS.Timeout | null = null;
    swapTimer = setInterval(() => setOrder(shuffled3()), SWAP_EVERY_MS);

    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / SHUFFLE_MS);
      setProgress(Math.floor(p * 100));
      if (p < 1) requestAnimationFrame(tick);
      else {
        if (swapTimer) clearInterval(swapTimer);
        setProgress(100);
        setPhase('pick');
        setBusy(false);
      }
    };
    requestAnimationFrame(tick);
  };

  const onPick = () => {
    if (phase !== 'pick' || busy) return;
    setBusy(true);
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
    <>
      {/* ===== Simple header so your chips are always visible ===== */}
      <div className="playground-header">
        <div className="title">Rebel Ants Playground</div>
        <div className="tabs">
          <span className="tab">Ant Tunnel</span>
          <span className="tab">Queen’s Egg Hatch</span>
          <span className="tab">Expedition</span>
          <span className="tab tab-active">Shuffle</span>
        </div>
      </div>

      {/* ===== Full‑screen ninja ant colony background ===== */}
      <div className="ant-colony-bg" aria-hidden="true" />

      <div className="ant-card ra-shuffle2">
        <div className="title">Queen&apos;s Egg Shuffle</div>
        <p className="subtitle">Three eggs. We shuffle. You pick one for a prize.</p>

        <div className="shuffle-scene ant-scene" style={{ position: 'relative' }}>
          {/* Inside‑scene dojo background */}
          <div className="scene-bg" aria-hidden="true" />

          <div className="strip" />

          {/* Queen 3D — centered and higher */}
          <Queen3D active={phase === 'shuffling'} scale={0.9} y={-0.08} />

          <div className="rail rail-top" />
          <div className="rail rail-bottom" />

          <AntProgress progress={progress} />

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

        <div className="shuffle-cta">
          <button className="btn" onClick={runShuffle} disabled={busy || phase === 'shuffling'}>
            {phase === 'shuffling' ? 'Shuffling…' : 'Shuffle'}
          </button>
        </div>

        {showPrize && <PrizeModal rarity={rarity} onClose={resetAfterPrize} />}
      </div>

      {/* Background CSS (scoped) */}
      <style jsx>{`
        .playground-header { position: relative; z-index: 5; margin: 10px 0 8px; }
        .playground-header .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }

        /* OUTSIDE background — supports webp and png; gradient & vector fallback */
        .ant-colony-bg {
          position: fixed; inset: 0; pointer-events: none; z-index: 0;
          background-image:
            linear-gradient(140deg, rgba(11,27,49,0.35), rgba(7,13,26,0.6)),
            image-set(
              url('/bg/colony.webp') type('image/webp'),
              url('/bg/colony.png') type('image/png')
            ),
            url("data:image/svg+xml;utf8,\
              <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 600'>\
                <g fill='rgba(24,36,64,0.55)'>\
                  <rect x='120' y='380' width='220' height='14'/>\
                  <rect x='170' y='340' width='120' height='16'/>\
                  <rect x='200' y='300' width='60' height='20'/>\
                  <rect x='780'  y='390' width='240' height='14'/>\
                  <rect x='830'  y='350' width='130' height='16'/>\
                  <rect x='860'  y='310' width='70'  height='20'/>\
                </g>\
                <g fill='rgba(32,48,86,0.45)'>\
                  <path d='M0,470 C180,420 320,480 520,460 C720,440 900,470 1200,430 L1200,600 L0,600 Z'/>\
                </g>\
              </svg>");
          background-position: center, center, center;
          background-size: cover, cover, cover;
          background-repeat: no-repeat, no-repeat, no-repeat;
          filter: saturate(1.05);
        }

        /* IN-SCENE background — supports webp and png with fallback */
        .scene-bg {
          position: absolute; inset: 0; z-index: 1; pointer-events: none; border-radius: 12px;
          background-image:
            linear-gradient(180deg, rgba(0,0,0,.28), rgba(0,0,0,.28)),
            image-set(
              url('/bg/dojo.webp') type('image/webp'),
              url('/bg/dojo.png')  type('image/png')
            ),
            radial-gradient(60% 80% at 50% 14%, rgba(255,255,255,.10), rgba(0,0,0,0) 70%),
            linear-gradient(180deg, rgba(17,27,48,.85), rgba(10,18,36,.95)),
            repeating-linear-gradient(90deg, rgba(255,255,255,.08) 0 2px, rgba(255,255,255,0) 2px 22px);
          background-position: center, center, center, center, center;
          background-size: cover, cover, cover, cover, cover;
          background-repeat: no-repeat;
          box-shadow: inset 0 12px 30px rgba(0,0,0,.45);
        }
      `}</style>
    </>
  );
}
