import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** The WAI-ARIA dialog contract — Escape, Tab focus trap, initial focus, focus
 * restoration on close, and body scroll-lock. Shared by ModalShell and
 * ChartFullscreenModal so the two dialogs can't drift apart.
 *
 * Returns the ref the dialog card must carry. The card is also the focus target
 * of last resort (when it holds nothing focusable), so it needs `tabIndex={-1}`.
 * Portaling is left to the caller — the contract here is focus + keys only. */
export function useModalA11y(open: boolean, onClose: () => void) {
  const cardRef = useRef<HTMLDivElement>(null)

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

  // Body scroll-lock + focus restoration while open. Deps are [open] only, on
  // purpose: `restoreTo` must capture the trigger BEFORE initial focus moves.
  useEffect(() => {
    if (!open) return
    const restoreTo = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Initial focus: first focusable inside the card, else the card itself.
    const card = cardRef.current
    const target = card?.querySelector<HTMLElement>(FOCUSABLE) ?? card ?? null
    target?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      restoreTo?.focus?.()
    }
  }, [open])

  return cardRef
}
