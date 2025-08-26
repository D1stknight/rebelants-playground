// components/PrizeModalHost.tsx
import React, { createContext, useContext, useState } from 'react';
import PrizeModal from './PrizeModal';

type ModalState = {
  open: boolean;
  label: string;
  sub?: string;
  content?: React.ReactNode;
};

type Ctx = {
  show: (opts: { label: string; sub?: string; content?: React.ReactNode }) => void;
  hide: () => void;
};

const PrizeModalCtx = createContext<Ctx | null>(null);

export function usePrizeModal() {
  const ctx = useContext(PrizeModalCtx);
  if (!ctx) throw new Error('usePrizeModal must be used within <PrizeModalProvider>');
  return ctx;
}

type ProviderProps = { children: React.ReactNode };

export default function PrizeModalProvider({ children }: ProviderProps) {
  const [m, setM] = useState<ModalState>({ open: false, label: '' });

  const show: Ctx['show'] = ({ label, sub, content }) =>
    setM({ open: true, label, sub, content });

  const hide = () => setM((s) => ({ ...s, open: false }));

  return (
    <PrizeModalCtx.Provider value={{ show, hide }}>
      {children}
      <PrizeModal open={m.open} onClose={hide} label={m.label} sub={m.sub}>
        {m.content}
      </PrizeModal>
    </PrizeModalCtx.Provider>
  );
}
