import { X } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useModalA11y } from '../../hooks/useModalA11y'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}

/** Near-fullscreen overlay for viewing a chart large. Body fills its parent so
 *  recharts' height="100%" expands. Dialog contract (focus trap, initial focus,
 *  focus restoration, scroll-lock, Escape) comes from useModalA11y, shared with
 *  ModalShell. Portaled to <body> like ModalShell: chat share cards open this
 *  from inside a message bubble, which would otherwise leak its own-message
 *  `bg-accent text-bg`, `text-sm` and `overflow-hidden` onto the dialog. */
export function ChartFullscreenModal({ open, onClose, title, children }: Props) {
  const { t } = useTranslation()
  const cardRef = useModalA11y(open, onClose)
  const titleId = useId()

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex bg-black/70 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="hint-pop mx-auto flex h-full w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop outline-none"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h3 id={titleId} className="truncate font-display text-lg font-bold text-ink">
            {title || t('chartFullscreenModal.chart')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('chartFullscreenModal.close')}
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X size={18} strokeWidth={2.25} />
          </button>
        </div>
        <div className="min-h-0 flex-1 p-4 sm:p-6">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
