import { useState } from 'react'
import { ModalShell } from './ModalShell'

interface Props {
  open: boolean
  onClose: () => void
  onConfirm: () => Promise<void> | void
  title: string
  message: string
  confirmLabel?: string
}

/** Reusable destructive-action confirmation dialog. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Sil',
}: Props) {
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
      onClose()
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink"
          >
            Ləğv et
          </button>
          <button
            onClick={confirm}
            disabled={busy}
            className="rounded-xl bg-[#D87C6B] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 active:translate-y-px disabled:opacity-60"
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      }
    >
      <p className="p-5 text-sm leading-relaxed text-ink-soft">{message}</p>
    </ModalShell>
  )
}
