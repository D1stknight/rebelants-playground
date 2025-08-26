// components/AntTunnel.tsx
import React, { useState } from 'react';
import PrizeModal from './PrizeModal';

export default function AntTunnel() {
  const [seed, setSeed] = useState(`guest-${Math.random().toString(36).slice(2,8)}`);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<{open:boolean; label:string; sub?:string}>({open:false, label:''});

  async function sendScout() {
    if (busy) return;
    setBusy(true);
    const res = await fetch('/api/tunnel', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({seed}) });
    const data = await res.json();
    setBusy(false);
    setModal({ open:true, label: data.type === 'crate' ? `${data.rarity} Loot Crate` : 'Nothing this time', sub: data.type === 'crate' ? 'Nice pull!' : 'Try again tomorrow.' });
  }

  return (
    <section className="ant-card">
      <h2 className="title">Ant Tunnel Forage</h2>
      <p className="subtitle">Daily $REBEL forage — steady rewards.</p>

      <div className="flex gap-2 mt-4">
        <input
          className="px-3 py-2 rounded border border-slate-700 bg-slate-900/70 flex-1"
          value={seed}
          onChange={(e)=>setSeed(e.target.value)}
        />
        <button className="btn" onClick={sendScout} disabled={busy}>
          {busy ? 'Sending…' : 'Send Scout'}
        </button>
      </div>

      <PrizeModal open={modal.open} onClose={()=>setModal({...modal, open:false})} label={modal.label} sub={modal.sub} />
    </section>
  );
}
