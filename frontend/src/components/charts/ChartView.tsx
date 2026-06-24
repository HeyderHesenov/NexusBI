import { Download, Tags } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ChartConfig, ChartType } from '../../types'
import { downloadCsv } from '../../lib/csv'
import { ChartRenderer } from './ChartRenderer'
import { CHART_BTN, ChartToolbar } from './ChartToolbar'

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
  /** Optional filename stem for the CSV export. */
  exportName?: string
}

/** Interactive chart with a type switcher, legend toggle and CSV export —
 *  lets the user view the same result however they prefer. */
export function ChartView({ data, config, exportName = 'nexusbi' }: Props) {
  const [type, setType] = useState<ChartType>(config.chart_type)
  const [showLegend, setShowLegend] = useState(false)

  // Reset to the AI-suggested type when a new result arrives.
  useEffect(() => setType(config.chart_type), [config.chart_type])

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
            onClick={() => downloadCsv(data, `${exportName}.csv`)}
            aria-label="CSV yüklə"
            className={`${CHART_BTN} border border-line text-ink-soft hover:border-accent hover:text-ink`}
          >
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      <ChartRenderer data={data} config={activeConfig} showLegend={showLegend} />
    </div>
  )
}
