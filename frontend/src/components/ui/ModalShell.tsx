import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

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

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Shared modal chrome: overlay, centered card, header, outside-click + Escape
 * close, plus a full WAI-ARIA dialog contract — focus trap, initial focus,
 * focus restoration on close, body scroll-lock, and aria-modal labelling.
 * Portaled to <body> so triggers inside hover-reveal / overflow / opacity
 * containers can't leak those styles onto the open dialog. */
export function ModalShell({ open, onClose, title, subtitle, children, footer, wide }: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // Escape to close + Tab focus trap (single keydown listener).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const card = cardRef.current
      if (!card) return
      const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
      )
      if (items.length === 0) {
        e.preventDefault()
        card.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === card)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Body scroll-lock + focus restoration while open.
  useEffect(() => {
    if (!open) return
    const restoreTo = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Initial focus: first focusable inside the card, else the card itself.
    const card = cardRef.current
    const target =
      card?.querySelector<HTMLElement>(FOCUSABLE) ?? card ?? null
    target?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      restoreTo?.focus?.()
    }
  }, [open])

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
