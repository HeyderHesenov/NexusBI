import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import { formatMetricValue as fmt } from '../../lib/format'
import type { Adjustments } from '../../lib/metricTreeMath'
import type { EvaluatedNode } from '../../types'

interface Props {
  leaves: EvaluatedNode[]
  adjustments: Adjustments
  onChange: (leafId: string, pct: number) => void
  onClear: () => void
}

/** ±% range sliders for every leaf of the selected KPI tree. */
export function TwinSliders({ leaves, adjustments, onChange, onClear }: Props) {
  const { t } = useTranslation()
  // Only these leaves count — another KPI's adjustments must not surface the reset button.
  const touched = leaves.some((l) => adjustments[l.id] !== undefined)
  return (
    <div className="flex flex-col gap-4">
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
        return (
          <div key={leaf.id}>
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={sliderId} className="text-sm font-medium text-ink">
                {leaf.name}
              </label>
              <span className="font-mono text-xs text-ink-soft">
                {fmt(base)}
                {pct !== 0 && (
                  <>
                    {' → '}
                    <span className={pct > 0 ? 'text-accent' : 'text-[#D87C6B]'}>
                      {fmt(adjusted)} ({pct > 0 ? '+' : ''}
                      {pct}%)
                    </span>
                  </>
                )}
              </span>
            </div>
            <input
              id={sliderId}
              type="range"
              min={-50}
              max={50}
              step={5}
              value={pct}
              onChange={(e) => onChange(leaf.id, Number(e.target.value))}
              className="mt-1 w-full accent-[color:rgb(var(--accent))]"
            />
          </div>
        )
      })}
    </div>
  )
}
