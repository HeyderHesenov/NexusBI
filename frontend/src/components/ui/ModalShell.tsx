import { useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModalA11y } from '../../hooks/useModalA11y'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  /** Wide layout (multi-column forms): max-w-3xl instead of max-w-md. */
  wide?: boolean
}

/** Shared modal chrome: overlay, centered card, header, outside-click close.
 * The WAI-ARIA dialog contract (focus trap, initial focus, focus restoration,
 * scroll-lock, Escape) comes from useModalA11y, shared with ChartFullscreenModal.
 * Portaled to <body> so triggers inside hover-reveal / overflow / opacity
 * containers can't leak those styles onto the open dialog. */
export function ModalShell({ open, onClose, title, subtitle, children, footer, wide }: Props) {
  const cardRef = useModalA11y(open, onClose)
  const titleId = useId()

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`flex w-full flex-col rounded-2xl border border-line bg-surface shadow-pop outline-none ${
          wide ? 'max-h-[85vh] max-w-3xl' : 'max-h-[70vh] max-w-md'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="border-b border-line px-5 py-4">
            <h3 id={titleId} className="font-display text-lg font-bold text-ink">
              {title}
            </h3>
            {subtitle && <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer && <div className="border-t border-line p-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
