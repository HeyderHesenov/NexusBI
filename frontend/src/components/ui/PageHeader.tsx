import type { ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  subtitle?: string
  /** Right-aligned actions (buttons, toggles). Wraps under the title on narrow screens. */
  actions?: ReactNode
  className?: string
}

/** The canonical page header: eyebrow + display h1 + optional subtitle, with an
 *  optional right-aligned actions slot. Replaces the hand-rolled
 *  `eyebrow` + `<h1 font-display text-3xl…>` repeated across pages (and the odd
 *  `<h2>` on HistoryPage), so headers stay consistent and responsive. */
export function PageHeader({ eyebrow, title, subtitle, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={`mb-6 flex flex-wrap items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
