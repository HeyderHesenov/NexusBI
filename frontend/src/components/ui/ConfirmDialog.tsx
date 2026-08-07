import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  confirmLabel,
}: Props) {
  const { t } = useTranslation()
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
            {t('confirmDialog.cancel')}
          </button>
          {/* `text-bg`, not `text-white`. White reads 5.58:1 on the light
              --danger but only 2.99:1 on the lighter dark-mode one, so this
              button failed AA in dark mode while passing in light. --bg follows
              the theme and clears 4.5:1 both ways (light 5.29, dark 6.04) —
              measured, not assumed. This is the app's only solid `bg-danger`
              surface; every other danger fill is /10–/15 under text-danger.

              `hover:bg-danger-press`, not `hover:opacity-90`: element opacity
              fades the label along with the fill, and the hovered pair measures
              4.39:1 in light mode — a state that fails while the resting state
              passes. The press token keeps the label solid (7.24 light / 4.91
              dark) and matches what every solid accent button already does.
              `disabled:opacity-60` stays: 1.4.3 exempts inactive controls. */}
          <button
            onClick={confirm}
            disabled={busy}
            className="rounded-xl bg-danger px-4 py-2 text-sm font-semibold text-bg transition hover:bg-danger-press active:translate-y-px disabled:opacity-60"
          >
            {busy ? '…' : confirmLabel ?? t('confirmDialog.delete')}
          </button>
        </div>
      }
    >
      <p className="p-5 text-sm leading-relaxed text-ink-soft">{message}</p>
    </ModalShell>
  )
}
