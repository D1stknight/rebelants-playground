// components/PrizeModal.tsx
import React from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  label: string;
  sub?: string;
  children?: React.ReactNode;
};

export default function PrizeModal({ open, onClose, label, sub, children }: Props) {
  if (!open) return null;

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card pop-in" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">{label}</h3>
        {sub && <p className="mt-1 text-slate-400">{sub}</p>}
        {children && <div className="mt-4">{children}</div>}
        <button className="btn mt-4 w-full" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
