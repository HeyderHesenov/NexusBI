import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import { formatMetricValue as fmt } from '../../lib/format'
import { DANGER } from '../charts/theme'
import type { Adjustments } from '../../lib/metricTreeMath'
import type { EvaluatedNode } from '../../types'

interface Props {
  leaves: EvaluatedNode[]
  adjustments: Adjustments
  onChange: (leafId: string, pct: number) => void
  onClear: () => void
}

const clampPct = (v: number) => Math.max(-95, Math.min(500, v))

/** ±% levers for every leaf of the selected KPI tree: a slider for feel plus a
 *  precise numeric entry, with a live base → adjusted readout. */
export function TwinSliders({ leaves, adjustments, onChange, onClear }: Props) {
  const { t } = useTranslation()
  // Only these leaves count — another KPI's adjustments must not surface reset.
  const touched = leaves.some((l) => adjustments[l.id] !== undefined)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="eyebrow">{t('twinPage.levers')}</p>
        {touched && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 text-xs font-medium text-ink-soft transition hover:text-accent"
          >
            <RotateCcw size={12} /> {t('twinPage.reset')}
          </button>
        )}
      </div>

      {leaves.map((leaf) => {
        const pct = adjustments[leaf.id] ?? 0
        const base = leaf.manual_value ?? 0
        const adjusted = base * (1 + pct / 100)
        const sliderId = `twin-${leaf.id}`
        const up = pct > 0
        return (
          <div key={leaf.id} className="rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={sliderId} className="truncate text-sm font-medium text-ink">
                {leaf.name}
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  aria-label={`${leaf.name} %`}
                  value={pct}
                  step={1}
                  onChange={(e) => onChange(leaf.id, clampPct(Number(e.target.value) || 0))}
                  className="w-16 rounded-lg border border-line bg-bg px-2 py-1 text-right font-mono text-sm text-ink focus:border-accent focus:outline-none"
                />
                <span className="text-xs text-ink-faint">%</span>
              </div>
            </div>

            <input
              id={sliderId}
              type="range"
              min={-50}
              max={50}
              step={1}
              value={Math.max(-50, Math.min(50, pct))}
              onChange={(e) => onChange(leaf.id, Number(e.target.value))}
              className="mt-2 w-full accent-[color:rgb(var(--accent))]"
            />

            <div className="mt-1 flex items-baseline justify-between font-mono text-xs">
              <span className="text-ink-faint">{fmt(base)}</span>
              {pct !== 0 && (
                <span style={up ? undefined : { color: DANGER }}>
                  <span className={up ? 'text-accent' : ''}>
                    → {fmt(adjusted)} ({up ? '+' : ''}{pct}%)
                  </span>
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
