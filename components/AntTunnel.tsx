import React, { useState } from 'react';
import PrizeModal from './PrizeModal';

export default function AntTunnel() {
  const [seed, setSeed] = useState('guest-' + Math.random().toString(36).slice(2, 8));
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<{open:boolean; label:string; sub?:string}>({open:false, label:''});

  async function play() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/expedition', { // reuse simple prize roll
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ seed })
      }).then(r => r.json());

      const p = res.prize as { type:'crate' | 'none'; label:string; rarity?:'common'|'rare'|'ultra' };
      if (p.type === 'crate') {
        setModal({ open:true, label: p.label, sub: p.rarity?.toUpperCase() });
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
        <h2 className="title">Ant Tunnel Forage</h2>
        <p className="subtitle">Daily $REBEL forage — steady rewards.</p>
      </header>

      <div className="flex gap-3">
        <input
          className="w-[260px] rounded-md bg-slate-900/60 border border-slate-700 px-3 py-2 text-sm"
          value={seed}
          onChange={e => setSeed(e.target.value)}
        />
        <button className="btn" onClick={play} disabled={busy}>
          {busy ? 'Sending…' : 'Send Scout'}
        </button>
      </div>

      <PrizeModal
        open={modal.open}
        onClose={() => setModal({ ...modal, open:false })}
        label={modal.label}
        sub={modal.sub}
      />
    </section>
  );
}
