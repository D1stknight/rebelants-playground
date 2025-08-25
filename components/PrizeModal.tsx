import { useEffect } from 'react'

type Props = {
  open: boolean
  onClose: () => void
  label: string
  sub?: string
  children?: React.ReactNode
}
export default function PrizeModal({ open, onClose, label, sub, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="ant-card max-w-md w-full text-center">
        <h3 className="text-2xl font-bold mb-2">You found:</h3>
        <p className="text-lg">{label}</p>
        {sub && <p className="text-slate-400 mt-1">{sub}</p>}
        {children}
        <button className="btn mt-6" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
