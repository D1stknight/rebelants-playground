// components/PrizeModalHost.tsx
import React, { useEffect, useState } from 'react';

type Prize = { label: string; type: 'crate' | 'none'; rarity: 'common' | 'rare' | 'ultra' | null; sub?: string | null };

export default function PrizeModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [prize, setPrize] = useState<Prize>({ label: '', type: 'none', rarity: null });

  useEffect(() => {
    function onPrize(e: Event) {
      const detail = (e as CustomEvent).detail as Prize;
      setPrize(detail);
      setOpen(true);
    }
    window.addEventListener('rebelants:prize' as any, onPrize);
    return () => window.removeEventListener('rebelants:prize' as any, onPrize);
  }, []);

  return (
    <>
      {children}
      {open && (
        <div className="prize-modal">
          <div className="prize-box">
            <div className="prize-title">{prize.label}</div>
            {prize.sub && <div className="prize-sub">{prize.sub}</div>}
            <button className="btn" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
