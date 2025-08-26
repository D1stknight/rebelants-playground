// components/QueenEgg.tsx
import React, { useState } from 'react';
import PrizeModal from './PrizeModal';

export default function QueenEgg({ variant = 'hatch' }: { variant?: 'hatch'|'shuffle' }) {
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<{open:boolean; label:string; sub?:string}>({open:false, label:''});

  async function crack() {
    if (busy) return;
    setBusy(true);
    const res = await fetch('/api/hatch', { method:'POST' });
    const data = await res.json();
    setBusy(false);
    setModal({ open:true, label: data.type === 'crate' ? `${data.rarity} Loot Crate` : 'Nothing this time', sub: data.type === 'crate' ? 'Royal vibes.' : 'The Queen says try again.' });
  }

  return (
    <section className="ant-card">
      <h2 className="title">Queen&apos;s Egg {variant === 'shuffle' ? 'Shuffle' : 'Hatch'}</h2>
      <p className="subtitle">
        {variant === 'shuffle'
          ? 'Three eggs. Pick one. Flip for a prize.'
          : "Crack an egg for a shot at the Queen’s crates. Jackpot vibes."}
      </p>

      {variant === 'shuffle' ? (
        <div className="mt-6 grid grid-cols-3 gap-6 max-w-lg">
          {[0,1,2].map(i=>(
            <button key={i} className="egg-card group" onClick={crack} disabled={busy}>
              <div className="egg wobble-on-hover" />
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-8 flex flex-col items-center">
          <div className="egg big bounce mb-6" />
          <button className="btn" onClick={crack} disabled={busy}>
            {busy ? 'Cracking…' : 'Crack Egg'}
          </button>
        </div>
      )}

      <PrizeModal open={modal.open} onClose={()=>setModal({...modal, open:false})} label={modal.label} sub={modal.sub} />
    </section>
  );
}
