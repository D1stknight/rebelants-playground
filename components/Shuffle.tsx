import React, { useMemo, useState, useEffect } from 'react';
import PrizeModal from './PrizeModal';

type Phase = 'idle' | 'shuffling' | 'pick' | 'revealed';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Shuffle() {
  // --- state
  const [phase, setPhase] = useState<Phase>('idle');
  const [order, setOrder] = useState<number[]>([0, 1, 2]);
  const [canPick, setCanPick] = useState(false);
  const [busy, setBusy] = useState(false);

  // Local modal (so reveal always works), + keep firing the global event
  const [modal, setModal] = useState<{ open: boolean; label: string; sub?: string | null; rarity?: string | null; type?: string | null }>({
    open: false,
    label: '',
  });

  // always reset on mount
  useEffect(() => {
    setPhase('idle');
    setCanPick(false);
  }, []);

  // fixed visual “lanes” (we’ll center each card via CSS transform)
  const lanes = useMemo(() => ['12%', '50%', '88%'], []);

  // --- actions
  const runShuffle = async () => {
    if (busy) return;
    setBusy(true);
    setCanPick(false);
    setPhase('shuffling');

    // 22–28 swaps with easing
    const swaps = 22 + Math.floor(Math.random() * 7);
    for (let i = 0; i < swaps; i++) {
      setOrder((prev) => {
        // randomly choose two distinct positions to swap
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

      const label = data?.prizeLabel ?? 'Nothing this time';
      const type = data?.type ?? 'none';
      const rarity = data?.rarity ?? null;
      const sub = data?.sub ?? null;

      // local modal (always shows)
      setModal({ open: true, label, sub, rarity, type });

      // global event (for any listeners)
      window.dispatchEvent(
        new CustomEvent('rebelants:prize', {
          detail: { label, type, rarity, sub },
        })
      );
    } catch {
      setModal({ open: true, label: 'Nothing this time', sub: 'Try again soon.', rarity: null, type: 'none' });
      window.dispatchEvent(
        new CustomEvent('rebelants:prize', {
          detail: { label: 'Nothing this time', type: 'none', rarity: null },
        })
      );
    }

    setPhase('revealed');
    await wait(400);
    setBusy(false);
  };

  // CTA
  const ctaLabel =
    phase === 'idle' || phase === 'revealed' ? 'Shuffle' : phase === 'shuffling' ? 'Shuffling…' : 'Pick an egg';
  const ctaDisabled = busy || phase === 'shuffling' || phase === 'pick';

  return (
    <div className="ant-card">
      <div className="title">Queen&apos;s Egg Shuffle</div>
      <p className="subtitle">Three eggs. We shuffle. You pick one for a prize.</p>

      {/* Scene */}
      <div className="shuffle-scene ant-scene">
        <div className="strip" />
        <div className="rail rail-top" />
        <div className="rail rail-bottom" />

        {/* Three egg cards; visual order is from `order[]` */}
        {order.map((eggId, pos) => (
          <button
            key={eggId}
            className={`egg-card ${canPick ? 'can-pick' : ''}`}
            style={{ left: lanes[pos], top: '56%' }}
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

      {/* CTA outside scene (avoid clipping) */}
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

      {/* Local modal fallback */}
      <PrizeModal
        open={modal.open}
        onClose={() => setModal((m) => ({ ...m, open: false }))}
        label={modal.label}
        sub={modal.sub ?? undefined}
      />
    </div>
  );
}
