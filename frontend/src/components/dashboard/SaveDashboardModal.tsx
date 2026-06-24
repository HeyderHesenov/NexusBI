import { useState } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  onSave: (name: string) => void
}

export function SaveDashboardModal({ open, onClose, onSave }: Props) {
  const [name, setName] = useState('')
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand/30 backdrop-blur-sm">
      <div className="w-80 rounded-2xl border border-grid bg-panel p-6 shadow-card">
        <h3 className="mb-1 font-display text-xl font-bold text-ink">Dashboard-a saxla</h3>
        <p className="mb-4 text-sm text-muted">Panelinə ad ver.</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())}
          placeholder="Dashboard adı"
          className="mb-4 w-full rounded-xl border border-grid bg-paper px-4 py-2.5 text-ink placeholder:text-muted/70 focus:border-brand focus:bg-panel focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-muted transition hover:text-ink"
          >
            Ləğv et
          </button>
          <button
            onClick={() => name.trim() && onSave(name.trim())}
            className="rounded-xl bg-signal px-4 py-2 text-sm font-semibold text-brand shadow-key transition active:translate-y-0.5 active:shadow-none"
          >
            Saxla
          </button>
        </div>
      </div>
    </div>
  )
}
