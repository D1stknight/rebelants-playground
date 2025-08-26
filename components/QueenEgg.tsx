import React, { useState } from 'react';
import PrizeModal from './PrizeModal';

const crateImg: Record<'common'|'rare'|'ultra', string> = {
  common: '/crates/common.png',
  rare: '/crates/rare.png',
  ultra: '/crates/ultra.png',
};

export default function QueenEgg() {
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<{open:boolean; label:string; sub?:string; rarity?:'common'|'rare'|'ultra'}>({open:false, label:''});

  async function crack() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/hatch', { method:'POST' }).then(r => r.json());
      const p = res.prize as { type:'crate'|'none'; label:string; rarity?:'common'|'rare'|'ultra' };
      if (p.type === 'crate') {
        setModal({ open:true, label:p.label, sub:p.rarity?.toUpperCase(), rarity:p.rarity });
      } else {
        setModal({ open:true, label:'Nothing this time' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ant-card relative overflow-hidden">
      <header className="mb-4">
        <h2 className="title">Queen&apos;s Egg Hatch</h2>
        <p className="subtitle">Crack an egg for a shot at the Queen&apos;s crates. Jackpot vibes.</p>
      </header>

      <div className="h-40 grid place-items-center">
        <div className="relative">
          <div className="mx-auto w-16 h-16 rounded-full bg-yellow-400 shadow-lg animate-bounce"></div>
        </div>
      </div>

      <div className="text-center">
        <button className="btn" onClick={crack} disabled={busy}>
          {busy ? 'Cracking…' : 'Crack Egg'}
        </button>
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
