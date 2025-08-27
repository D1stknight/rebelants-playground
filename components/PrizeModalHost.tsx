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
      setP({
        label: d?.label ?? 'Nothing this time',
        type: (d?.type ?? 'none') as Prize['type'],
        rarity: (d?.rarity ?? null) as Rarity,
        sub: d?.sub ?? null,
      });
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

  const imgSrc =
    p.type === 'crate'
      ? p.rarity === 'ultra'
        ? '/crates/ultra.png'
        : p.rarity === 'rare'
        ? '/crates/rare.png'
        : '/crates/common.png'
      : null;

  return (
    <>
      {children}

      {open && (
        <div className="prize-modal">
          <div className={`prize-card pop-in ${rarityClass}`}>
            {/* If there is an image, show it. Otherwise, show a CSS crate block as fallback */}
            {imgSrc ? (
              <img className="prize-art" src={imgSrc} alt={p.label} />
            ) : (
              <div className="prize-crate" />
            )}

            <div className="prize-title">{p.label}</div>
            {p.sub && <div className="prize-sub">{p.sub}</div>}

            <button className="btn" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
