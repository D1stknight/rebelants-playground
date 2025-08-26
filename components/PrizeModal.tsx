import React from 'react'

type Props = {
  open: boolean
  onClose: () => void
  label: string
  sub?: string
  children?: React.ReactNode
}

export default function PrizeModal({ open, onClose, label, sub, children }: Props) {
  if (!open) return null
  return (
    <div className="modal">
      <div className="modal-card ant-card">
        <h3 className="title mb-1">{label}</h3>
        {sub && <p className="subtitle mb-3">{sub}</p>}
        {children}
        <div className="text-right mt-4">
          <button onClick={onClose} className="btn">Close</button>
        </div>
      </div>
    </div>
  )
}
