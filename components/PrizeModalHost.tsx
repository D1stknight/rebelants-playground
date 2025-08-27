// components/PrizeModalHost.tsx
import React, { useEffect, useRef, useState } from 'react';

type Rarity = 'common' | 'rare' | 'ultra' | null;
type Prize = { label: string; type: 'crate' | 'none'; rarity: Rarity; sub?: string | null };

export default function PrizeModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<Prize>({ label: '', type: 'none', rarity: null });
  const cardRef = useRef<HTMLDivElement | null>(null);

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

  // Rarity sparkles (already in your version)
  useEffect(() => {
    if (!open || p.type !== 'crate' || !cardRef.current) return;

    const node = cardRef.current;
    const count = p.rarity === 'ultra' ? 16 : p.rarity === 'rare' ? 12 : 8;
    const cls =
      p.rarity === 'ultra' ? 'sparkle-ultra' :
      p.rarity === 'rare'  ? 'sparkle-rare'  :
      'sparkle-common';

    const created: HTMLElement[] = [];
    for (let i = 0; i < count; i++) {
      const s = document.createElement('div');
      s.className = `sparkle ${cls} animate`;
      const angle = Math.random() * Math.PI * 2;
      const radiusPx = 70 + Math.random() * 50;
      const x = 50 + (Math.cos(angle) * radiusPx) / (node.clientWidth / 100);
      const y = 50 + (Math.sin(angle) * radiusPx) / (node.clientHeight / 100);
      s.style.left = `${x}%`;
      s.style.top = `${y}%`;
      s.style.animationDuration = `${0.9 + Math.random() * 0.8}s`;
      s.style.transform = `scale(${0.7 + Math.random() * 0.6})`;
      node.appendChild(s);
      created.push(s);
    }
    const t = setTimeout(() => { created.forEach(el => el.remove()); }, 1800);
    return () => clearTimeout(t);
  }, [open, p.type, p.rarity]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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
        <div className="prize-modal" onClick={() => setOpen(false)}>
          <div
            ref={cardRef}
            className={`prize-card pop-in ${rarityClass}`}
            onClick={(e) => e.stopPropagation()} // don't close when clicking the card itself
          >
            {/* Aura glow behind the crate */}
            {p.type === 'crate' && <div className="prize-aura" data-rarity={p.rarity ?? 'common'} />}

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
