import type { ReactNode } from 'react'

interface EmptyStateProps {
  /** Optional decorative icon above the title. */
  icon?: ReactNode
  title: string
  description?: string
  /** Optional CTA, typically a <Button/>. */
  action?: ReactNode
  /** Vertical presence — 'lg' for a hero empty (min-h-[50vh]), 'md' default. */
  size?: 'md' | 'lg'
  className?: string
}

const MIN_H: Record<NonNullable<EmptyStateProps['size']>, string> = {
  md: 'min-h-[220px]',
  lg: 'min-h-[50vh]',
}

/** The one empty state for the whole app — the dashed `.plot-grid` substrate with
 *  a display title, optional description and CTA. Replaces the three hand-rolled
 *  variants (local EmptyState components + inline plot-grid blocks). */
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`plot-grid flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-16 text-center ${MIN_H[size]} ${className}`}
    >
      {icon && <div className="mb-3 text-ink-faint">{icon}</div>}
      <p className="font-display text-lg text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-soft">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
