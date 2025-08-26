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
      <div className="modal-card" onClick={(e)=>e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-2">{label}</h3>
        {sub && <p className="text-slate-300 mb-3">{sub}</p>}
        {children}
        <div className="mt-4 text-right">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
