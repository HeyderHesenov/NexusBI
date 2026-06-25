import { useMemo, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { ChartRenderer } from './ChartRenderer'
import type { ChartConfig } from '../../types'

interface Props {
  data: Record<string, unknown>[]
  valueCol: string | null
}

/** What-if: apply a % adjustment to the metric and compare actual vs scenario. */
export function ScenarioPanel({ data, valueCol }: Props) {
  const [pct, setPct] = useState('10')

  const { actual, projected } = useMemo(() => {
    if (!valueCol) return { actual: 0, projected: 0 }
    const sum = data.reduce((s, r) => s + (Number(r[valueCol]) || 0), 0)
    const factor = 1 + (Number(pct) || 0) / 100
    return { actual: sum, projected: sum * factor }
  }, [data, valueCol, pct])

  if (!valueCol) {
    return (
      <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink-faint">
        Ssenari üçün ədədi sütun tapılmadı.
      </div>
    )
  }

  const delta = projected - actual
  const compareData = [
    { ssenari: 'Faktiki', dəyər: Math.round(actual * 100) / 100 },
    { ssenari: 'Ssenari', dəyər: Math.round(projected * 100) / 100 },
  ]
  const compareConfig = {
    chart_type: 'bar',
    x_axis: 'ssenari',
    y_axis: 'dəyər',
    color_by: null,
  } as ChartConfig

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={15} className="text-accent" />
          <span className="eyebrow text-ink-soft">What-if · {valueCol}</span>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          Dəyişiklik
          <input
            type="number"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className="w-20 rounded-lg border border-line bg-surface px-2 py-1 text-ink focus:border-accent focus:outline-none"
          />
          %
        </label>
        <span className="font-mono text-xs text-ink-faint">
          {actual.toLocaleString()} → <span className="text-ink">{projected.toLocaleString()}</span>{' '}
          <span className={delta >= 0 ? 'text-accent' : 'text-[#D87C6B]'}>
            ({delta >= 0 ? '+' : ''}{delta.toLocaleString()})
          </span>
        </span>
      </div>
      <ChartRenderer data={compareData} config={compareConfig} height={200} />
    </div>
  )
}
