import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * The Twin's "nothing to simulate" surface: dashed plot-grid panel, icon, one
 * explanatory paragraph, one accent CTA back to the tree.
 *
 * Shared because TwinPage's empty tree and IncompleteNotice's unknown-leaf
 * refusal were the same markup twice, differing only in icon and copy — so a
 * change to the treatment had two places to land and one to drift in.
 * `children` is the only extension point (IncompleteNotice lists the empty
 * leaves there); everything else is the same by construction.
 */
export function TwinEmptyState({
  icon: Icon,
  title,
  body,
  cta,
  onCta,
  children,
}: {
  icon: LucideIcon
  title: string
  body: string
  cta: string
  onCta: () => void
  children?: ReactNode
}) {
  return (
    <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
      <div className="max-w-lg">
        <Icon size={24} className="mx-auto text-ink-faint" />
        <p className="mt-3 font-display text-lg text-ink">{title}</p>
        <p className="mt-1 text-sm text-ink-soft">{body}</p>
        {children}
        <button
          type="button"
          onClick={onCta}
          className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press"
        >
          {cta}
        </button>
      </div>
    </div>
  )
}
