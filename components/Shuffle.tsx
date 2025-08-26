import React, { useState } from 'react';
import PrizeModal from './PrizeModal';

const crateImg: Record<'common'|'rare'|'ultra', string> = {
  common: '/crates/common.png',
  rare: '/crates/rare.png',
  ultra: '/crates/ultra.png',
};

export default function Shuffle() {
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<{open:boolean; label:string; sub?:string; rarity?:'common'|'rare'|'ultra'}>({open:false, label:''});
  const [pick, setPick] = useState<number | null>(null);

  async function choose(i: number) {
    if (busy) return;
    setBusy(true);
    setPick(i);
    try {
      const res = await fetch('/api/spin', { method:'POST' }).then(r => r.json());
      const p = res.prize as { type:'crate'|'none'; label:string; rarity?:'common'|'rare'|'ultra' };
      if (p.type === 'crate') {
        setModal({ open:true, label:p.label, sub:p.rarity?.toUpperCase(), rarity:p.rarity });
      } else {
        setModal({ open:true, label:'Nothing this time' });
      }
    } finally {
      setBusy(false);
      setTimeout(() => setPick(null), 600);
    }
  }

  return (
    <section className="ant-card relative overflow-hidden">
      <header className="mb-4">
        <h2 className="title">Queen&apos;s Egg Shuffle</h2>
        <p className="subtitle">Three eggs. Pick one. Flip for a prize.</p>
      </header>

      <div className="flex items-center justify-center gap-6 py-8">
        {[0,1,2].map(i => (
          <button
            key={i}
            disabled={busy}
            onClick={() => choose(i)}
            className={`w-20 h-28 rounded-xl bg-slate-900/60 border border-slate-700 shadow-lg transition
                        ${pick === i ? 'animate-wobble scale-105' : 'hover:scale-[1.03]'}`}
          >
            <div className="mx-auto mt-6 w-7 h-7 rounded-full bg-yellow-400 shadow" />
          </button>
        ))}
      </div>

      <PrizeModal
        open={modal.open}
        onClose={() => setModal({ ...modal, open:false })}
        label={modal.label}
        sub={modal.sub}
      >
        {modal.rarity ? (
          <img
            src={crateImg[modal.rarity]}
            alt={modal.rarity}
            className="mx-auto mt-4 w-28"
          />
        ) : null}
      </PrizeModal>
    </section>
  );
}
