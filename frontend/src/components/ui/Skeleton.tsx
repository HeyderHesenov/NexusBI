/** A single shimmering placeholder block. Give it width/height via `className`.
 *  reduced-motion users get a static block (the global reduced-motion guard in
 *  index.css neutralizes `animate-pulse`). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-2 ${className}`} aria-hidden="true" />
}

interface SkeletonRowsProps {
  rows?: number
  /** Height class for each row (default h-11, a table-row height). */
  rowClassName?: string
  className?: string
}

/** Stacked skeleton lines — the shared loading state for list/table pages so the
 *  UI shows "loading" instead of flashing the empty state before data arrives. */
export function SkeletonRows({ rows = 5, rowClassName = 'h-11', className = '' }: SkeletonRowsProps) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`${rowClassName} animate-pulse rounded-lg bg-surface-2`} />
      ))}
    </div>
  )
}
