// components/PrizeModalHost.tsx
import React, { useEffect, useState } from 'react';

type Rarity = 'common' | 'rare' | 'ultra' | null;
type Prize = { label: string; type: 'crate' | 'none'; rarity: Rarity; sub?: string | null };

export default function PrizeModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<Prize>({ label: '', type: 'none', rarity: null });

  useEffect(() => {
    const onPrize = (e: Event) => {
      const d = (e as CustomEvent).detail as Prize;
      setP({ label: d.label ?? 'Nothing this time', type: d.type ?? 'none', rarity: d.rarity ?? null, sub: d.sub ?? null });
      setOpen(true);
    };
    window.addEventListener('rebelants:prize' as any, onPrize);
    return () => window.removeEventListener('rebelants:prize' as any, onPrize);
  }, []);

  const rarityClass =
    p.type !== 'crate'
      ? 'pm-none'
      : p.rarity === 'ultra'
      ? 'pm-ultra'
      : p.rarity === 'rare'
      ? 'pm-rare'
      : 'pm-common';

  return (
    <>
      {children}
      {open && (
        <div className="prize-modal">
          <div className={`prize-card ${rarityClass}`}>
            <div className="prize-crate" />
            <div className="prize-title">{p.label}</div>
            {p.sub && <div className="prize-sub">{p.sub}</div>}
            <button className="btn" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
