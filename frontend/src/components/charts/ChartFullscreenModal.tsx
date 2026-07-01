import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}

/** Near-fullscreen overlay for viewing a chart large. Body fills its parent so
 *  recharts' height="100%" expands. Escape + backdrop close, body scroll lock. */
export function ChartFullscreenModal({ open, onClose, title, children }: Props) {
  const { t } = useTranslation()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/70 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || t('chartFullscreenModal.chart')}
        onClick={(e) => e.stopPropagation()}
        className="hint-pop mx-auto flex h-full w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h3 className="truncate font-display text-lg font-bold text-ink">
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
    </div>
  )
}
