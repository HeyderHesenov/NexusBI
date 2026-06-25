import { Download, Tags } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ChartConfig, ChartType } from '../../types'
import { downloadCsv } from '../../lib/csv'
import { ChartRenderer } from './ChartRenderer'
import { CHART_BTN, ChartToolbar } from './ChartToolbar'
import { FilterPills, type Filter } from './FilterPills'

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
  /** Optional filename stem for the CSV export. */
  exportName?: string
}

/** Interactive chart with a type switcher, legend toggle, CSV export and
 *  click-to-drill-down filtering — lets the user explore the same result. */
export function ChartView({ data, config, exportName = 'nexusbi' }: Props) {
  const [type, setType] = useState<ChartType>(config.chart_type)
  const [showLegend, setShowLegend] = useState(false)
  const [filters, setFilters] = useState<Filter[]>([])

  // Reset view state when a new result arrives.
  useEffect(() => {
    setType(config.chart_type)
    setFilters([])
  }, [config.chart_type, data])

  const addFilter = (field: string, value: unknown) => {
    if (value === undefined || value === null) return
    const next: Filter = { field, value: String(value) }
    setFilters((cur) =>
      cur.some((f) => f.field === next.field && f.value === next.value) ? cur : [...cur, next],
    )
  }

  const filtered = useMemo(
    () =>
      filters.length
        ? data.filter((row) => filters.every((f) => String(row[f.field]) === f.value))
        : data,
    [data, filters],
  )

  const activeConfig: ChartConfig = { ...config, chart_type: type }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ChartToolbar value={type} onChange={setType} />
        <div className="flex items-center gap-1">
          {type === 'pie' && (
            <button
              onClick={() => setShowLegend((v) => !v)}
              aria-pressed={showLegend}
              className={`${CHART_BTN} border ${
                showLegend ? 'border-accent text-accent' : 'border-line text-ink-soft hover:text-ink'
              }`}
            >
              <Tags size={14} /> Açıqlama
            </button>
          )}
          <button
            onClick={() => downloadCsv(filtered, `${exportName}.csv`)}
            aria-label="CSV yüklə"
            className={`${CHART_BTN} border border-line text-ink-soft hover:border-accent hover:text-ink`}
          >
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      <FilterPills
        filters={filters}
        onRemove={(i) => setFilters((cur) => cur.filter((_, idx) => idx !== i))}
        onClear={() => setFilters([])}
      />

      <ChartRenderer
        data={filtered}
        config={activeConfig}
        showLegend={showLegend}
        onPointClick={addFilter}
      />
    </div>
  )
}
