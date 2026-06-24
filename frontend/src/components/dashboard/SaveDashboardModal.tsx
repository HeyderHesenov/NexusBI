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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-80 rounded-xl border border-slate-700 bg-slate-900 p-5">
        <h3 className="mb-3 text-lg font-semibold text-slate-100">Dashboard-a saxla</h3>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Dashboard adı"
          className="mb-4 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-brand focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-300">
            Ləğv et
          </button>
          <button
            onClick={() => name.trim() && onSave(name.trim())}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-slate-900"
          >
            Saxla
          </button>
        </div>
      </div>
    </div>
  )
}
