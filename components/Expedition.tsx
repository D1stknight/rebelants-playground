// components/Expedition.tsx
import React, { useEffect, useRef, useState } from 'react';
import PrizeModal from './PrizeModal';

export default function Expedition() {
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [modal, setModal] = useState<{open:boolean; label:string; sub?:string}>({open:false, label:''});
  const antRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setPct(0);

    // progress anim ~5s
    const start = performance.now();
    const dur = 5200;
    function tick(t:number){
      const k = Math.min(1, (t - start)/dur);
      setPct(Math.round(k*100));
      // ant x movement
      if (antRef.current && barRef.current) {
        const w = barRef.current.clientWidth - 48;
        antRef.current.style.transform = `translateX(${w*k}px) translateY(${Math.sin(k*12)*2}px)`;
      }
      if (k < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    // fetch prize
    const res = await fetch('/api/expedition', { method:'POST' });
    const data = await res.json();

    // slight pause at end
    await new Promise(r=>setTimeout(r, 500));

    setBusy(false);
    setModal({ open:true, label: data.type === 'crate' ? `${data.rarity} Loot Crate` : 'Nothing this time', sub: data.type === 'crate' ? 'Long run paid off.' : 'The wilds were quiet.' });
  }

  return (
    <section className="ant-card">
      <h2 className="title">Colony Forage Expedition</h2>
      <p className="subtitle">Send a samurai ant on a longer run. 5-second expedition with bigger rewards.</p>

      <div className="ant-scene mt-5">
        <div className="sky" />
        <div className="stars" />
        <div className="plate shadow" />
        <div className="track" ref={barRef}>
          <div className="glow" />
          <div className="ticks">
            {[0,1,2,3,4].map(i=>(<span key={i} />))}
          </div>
        </div>

        {/* the “3D-ish” ant */}
        <div className="ant" ref={antRef}>
          <div className="ant-body">
            <span className="eye left" />
            <span className="eye right" />
          </div>
          <div className="kimono" />
          <div className="sword back" />
          <div className="sword front" />
          <div className="feet">
            <span/><span/>
          </div>
        </div>

        <div className="hud">
          <span>{pct}%</span>
        </div>
      </div>

      <div className="mt-5">
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? 'Exploring…' : 'Start Expedition'}
        </button>
      </div>

      <PrizeModal open={modal.open} onClose={()=>setModal({...modal, open:false})} label={modal.label} sub={modal.sub} />
    </section>
  );
}
