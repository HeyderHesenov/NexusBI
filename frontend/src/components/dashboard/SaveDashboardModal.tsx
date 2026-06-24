import { useState } from 'react'
import { ModalShell } from '../ui/ModalShell'

interface Props {
  open: boolean
  onClose: () => void
  onSave: (name: string) => void
}

export function SaveDashboardModal({ open, onClose, onSave }: Props) {
  const [name, setName] = useState('')
  const submit = () => name.trim() && onSave(name.trim())

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Yeni dashboard"
      subtitle="Panelinə ad ver."
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink"
          >
            Ləğv et
          </button>
          <button
            onClick={submit}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px"
          >
            Yarat
          </button>
        </div>
      }
    >
      <div className="p-5">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Dashboard adı"
          className="w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
      </div>
    </ModalShell>
  )
}
