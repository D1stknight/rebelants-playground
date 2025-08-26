import React from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  label: string;
  sub?: string;
  children?: React.ReactNode; // <— allow optional content
};

export default function PrizeModal({ open, onClose, label, sub, children }: Props) {
  if (!open) return null;
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card ant-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="title text-center mb-1">You found:</h3>
        <p className="text-center font-semibold">{label}</p>
        {sub && <p className="text-center text-slate-400 text-sm mt-1">{sub}</p>}
        {children ? <div className="mt-4">{children}</div> : null}
        <div className="text-center mt-5">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
