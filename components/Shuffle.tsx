import React, { useEffect, useMemo, useRef, useState } from 'react';

// Small helper: wait ms
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

type Phase = 'idle' | 'shuffling' | 'pick' | 'revealed';

export default function Shuffle() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [order, setOrder] = useState<number[]>([0, 1, 2]);   // visual order
  const [canPick, setCanPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const sceneRef = useRef<HTMLDivElement>(null);

  // layout: three fixed lanes we reuse no matter the order
  const lanes = useMemo(
    () => [
      { left: '8%',  top: '58%' },
      { left: '45%', top: '58%' },
      { left: '82%', top: '58%' }
    ],
    []
  );

  // shuffle animation: swaps indexes quickly then slows down
  const runShuffle = async () => {
    if (busy) return;
    setBusy(true);
    setPhase('shuffling');
    setCanPick(false);

    // 20–28 swaps with easing
    const swaps = 22 + Math.floor(Math.random() * 6);
    for (let i = 0; i < swaps; i++) {
      setOrder(prev => {
        // pick two distinct positions and swap
        let a = Math.floor(Math.random() * 3);
        let b = Math.floor(Math.random() * 3);
        while (b === a) b = Math.floor(Math.random() * 3);
        const next = [...prev];
        [next[a], next[b]] = [next[b], next[a]];
        return next;
      });
      // ease: faster at start, slower near the end
      const t = i / swaps;
      const dur = 70 + Math.floor(380 * t * t);
      // eslint-disable-next-line no-await-in-loop
      await wait(dur);
    }

    setPhase('pick');
    setCanPick(true);
    setBusy(false);
  };

  // egg click => fetch result and reveal
  const onPick = async (idx: number) => {
    if (!canPick || busy || phase !== 'pick') return;

    setBusy(true);
    setCanPick(false);

    try {
      // hit our API for a prize (uses your existing endpoint)
      const res = await fetch('/api/spin', { method: 'POST' });
      const data = await res.json();

      // broadcast a global prize event for the modal host (works with our PrizeModalHost)
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
    } catch (e) {
      window.dispatchEvent(
        new CustomEvent('rebelants:prize', {
          detail: { label: 'Nothing this time', type: 'none', rarity: null },
        })
      );
    }

    setPhase('revealed');
    // small pause before allowing another round
    await wait(600);
    setBusy(false);
  };

  // CTA label
  const ctaLabel =
    phase === 'idle' || phase === 'revealed'
      ? 'Shuffle'
      : phase === 'shuffling'
      ? 'Shuffling…'
      : 'Pick an egg';

  // CTA disabled rules
  const ctaDisabled = phase === 'shuffling' || phase === 'pick' || busy;

  return (
    <div className="ant-card">
      <div className="title">Queen&apos;s Egg Shuffle</div>
      <p className="subtitle">Three eggs. We shuffle. You pick one for a prize.</p>

      {/* scene */}
      <div ref={sceneRef} className="shuffle-scene ant-scene">
        {/* stage / strip */}
        <div className="strip" />
        {/* ambient sweeping lights */}
        <div className="sweep sweep-left" />
        <div className="sweep sweep-right" />
        {/* rail/progress purely decorative here */}
        <div className="rail" />

        {/* eggs */}
        {order.map((eggId, pos) => {
          const lane = lanes[pos];
          return (
            <div
              key={eggId}
              className={`egg-card ${canPick ? 'can-pick' : ''}`}
              style={{ left: lane.left, top: lane.top }}
              onClick={() => onPick(eggId)}
            >
              <div className={`egg-body ${canPick ? 'always-wobble' : ''}`} />
              <div className="egg-shadow" />
              <div className="egg-spec" />
            </div>
          );
        })}
      </div>

      {/* CTA always renders so it cannot disappear due to z-index/clipping */}
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
