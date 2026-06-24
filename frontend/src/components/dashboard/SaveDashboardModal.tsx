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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-80 rounded-2xl border border-line bg-surface p-6 shadow-pop">
        <h3 className="mb-1 font-display text-xl font-bold text-ink">Dashboard-a saxla</h3>
        <p className="mb-4 text-sm text-ink-soft">Panelinə ad ver.</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())}
          placeholder="Dashboard adı"
          className="mb-4 w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink"
          >
            Ləğv et
          </button>
          <button
            onClick={() => name.trim() && onSave(name.trim())}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px"
          >
            Saxla
          </button>
        </div>
      </div>
    </div>
  )
}
