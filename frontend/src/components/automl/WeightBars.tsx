import type { MLFeatureWeight } from '../../types'

interface Props {
  title: string
  items: MLFeatureWeight[]
  limit?: number
}

/** Horizontal feature-weight bars — shared by the built-in importances and the
 *  permutation importance so the two read identically. Bar length is relative to
 *  the strongest feature shown; the label is each feature's share. Weights are
 *  clamped at 0 (permutation importance can be negative for a useless feature). */
export function WeightBars({ title, items, limit = 10 }: Props) {
  const top = items.slice(0, limit)
  if (!top.length) return null
  const max = Math.max(...top.map((i) => i.weight), 0.0001)
  return (
    <div>
      <p className="eyebrow mb-2">{title}</p>
      <div className="flex flex-col gap-1.5">
        {top.map((i) => (
          <div key={i.feature} className="flex items-center gap-2 text-xs">
            <span className="w-40 truncate text-ink-soft" title={i.feature}>
              {i.feature}
            </span>
            <span className="h-2 flex-1 rounded-full bg-line">
              <span
                className="block h-2 rounded-full bg-accent"
                style={{ width: `${Math.max(0, (i.weight / max) * 100)}%` }}
              />
            </span>
            <span className="w-12 text-right font-mono text-ink-faint">
              {Math.round(Math.max(0, i.weight) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
