// components/PrizeModalHost.tsx
import React, { useEffect, useState } from 'react';

type Rarity = 'common' | 'rare' | 'ultra' | null;
type PrizeDetail = {
  label: string;
  type: 'crate' | 'none';
  rarity: Rarity;
  sub?: string | null;
};

export default function PrizeModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PrizeDetail>({
    label: '',
    type: 'none',
    rarity: null,
  });

  useEffect(() => {
    const onPrize = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      setDetail({
        label: d.label ?? 'Nothing this time',
        type: d.type ?? 'none',
        rarity: (d.rarity ?? null) as Rarity,
        sub: d.sub ?? null,
      });
      setOpen(true);
    };
    window.addEventListener('rebelants:prize', onPrize as EventListener);
    return () =>
      window.removeEventListener('rebelants:prize', onPrize as EventListener);
  }, []);

  return (
    <>
      {children}

      {open && (
        <div className="prize-modal">
          <div className="prize-modal__card">
            <div className="prize-modal__title">{detail.label}</div>
            <button className="btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
