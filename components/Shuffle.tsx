// RA: Shuffle v1.4 — button hard-pinned + centered lanes + working pick -> modal
import React, { useEffect, useMemo, useState } from 'react';

type Phase = 'idle' | 'shuffling' | 'pick' | 'revealed';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function Shuffle() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [order, setOrder] = useState<number[]>([0, 1, 2]);
  const [canPick, setCanPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  // lanes are centered via translateX(-50%) in CSS
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

    // 22–28 swaps with easing
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
      const eased = t < 0.6 ? 2 * t * t : -1 + (4 - 2 * t) * t; // in-out
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
    await wait(400);
    setBusy(false);
  }

  const label =
    phase === 'shuffling' ? 'Shuffling…' : phase === 'pick' ? 'Pick an egg' : 'Shuffle';
  const disabled = phase === 'shuffling' || phase === 'pick' || busy;

  return (
    <div className="ant-card">
      <div className="title">Queen&apos;s Egg Shuffle</div>
      <p className="subtitle">Three eggs. We shuffle. You pick one for a prize.</p>

      {/* Safety CTA pinned so it never disappears */}
      <button
        className="btn btn-safety"
        disabled={disabled}
        onClick={() => {
          if (phase === 'idle' || phase === 'revealed') runShuffle();
        }}
      >
        {label}
      </button>

      {/* Scene */}
      <div className="shuffle-scene ant-scene">
        <div className="strip" />
        <div className="rail rail-top" />
        <div className="rail rail-mid" />
        <div className="rail rail-bottom" />

        {order.map((eggId, pos) => (
          <button
            key={eggId}
            className={`egg-card ${canPick ? 'can-pick' : ''}`}
            style={{ left: `${lanes[pos]}%`, top: '58%' }}
            onClick={onPick}
            disabled={!canPick || busy}
            aria-label="Pick egg"
          >
            <div className={`egg-body ${canPick ? 'always-wobble' : ''}`} />
            <div className="egg-speckle" />
            <div className="egg-shadow" />
          </button>
        ))}
      </div>

      {/* Progress + bottom CTA (normal button) */}
      <div className="shuffle-progress">
        <div style={{ width: `${progress}%` }} />
      </div>

      <div className="shuffle-cta">
        <button
          className="btn"
          disabled={disabled}
          onClick={() => {
            if (phase === 'idle' || phase === 'revealed') runShuffle();
          }}
        >
          {label}
        </button>
      </div>
    </div>
  );
}
