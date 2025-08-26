import React, { useMemo, useRef, useState, useEffect } from 'react';

type Phase = 'idle' | 'shuffling' | 'pick' | 'revealed';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function Shuffle() {
  // Always start clean
  const [phase, setPhase] = useState<Phase>('idle');
  const [order, setOrder] = useState<number[]>([0, 1, 2]);
  const [canPick, setCanPick] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPhase('idle'); setCanPick(false); }, []);

  // fixed lanes for left positions
  const lanes = useMemo(() => ['8%', '45%', '82%'], []);

  const runShuffle = async () => {
    if (busy) return;
    setBusy(true);
    setCanPick(false);
    setPhase('shuffling');

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
      const t = i / swaps;
      const dur = 60 + Math.floor(360 * t * t);
      // eslint-disable-next-line no-await-in-loop
      await wait(dur);
    }

    setPhase('pick');
    setCanPick(true);
    setBusy(false);
  };

  const onPick = async () => {
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
    await wait(500);
    setBusy(false);
  };

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

      {/* Scene */}
      <div className="shuffle-scene ant-scene">
        <div className="strip" />
        <div className="rail rail-top" />
        <div className="rail rail-bottom" />

        {/* Three egg cards; their *visual* order changes via state */}
        {order.map((eggId, pos) => (
          <button
            key={eggId}
            className={`egg-card ${canPick ? 'can-pick' : ''}`}
            style={{
              left: lanes[pos],
              top: '56%',
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

      {/* CTA intentionally OUTSIDE the scene so it cannot be clipped */}
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
  );
}
