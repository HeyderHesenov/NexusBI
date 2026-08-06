import type { ChartConfig } from '../../../types'
import { useChartValueFormatter } from '../../../hooks/useChartValueFormatter'
import { deriveKpiSeries } from '../../../lib/kpi'
import { formatSignedPct } from '../../../lib/format'
import { Sparkline } from '../Sparkline'
import type { Row } from './previewData'

/** A KPI result compresses to a number + delta + sparkline (KPICard is p-10/text-6xl).
 *  The original of every other preview in this folder — it was the codebase's first
 *  answer to "this chart doesn't fit the box". */
export function KpiTilePreview({ data, config }: { data: Row[]; config: ChartConfig }) {
  const series = deriveKpiSeries(data, config)
  const fmtVal = useChartValueFormatter(config.format)
  // Tone and trend derive from the SAME 1-decimal rounding formatSignedPct
  // applies (mirrors KPICard), so a −0.02% delta can't pair a red tone with
  // a "+0%" label.
  const rounded = series.deltaPct == null ? null : Math.round(series.deltaPct * 10) / 10
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate font-display text-2xl font-bold text-ink">
          {series.latest != null ? fmtVal(series.latest, { compact: false }) : '—'}
        </p>
        {series.deltaPct != null && (
          <p
            className={`text-xs font-medium ${
              rounded === 0 ? 'text-ink-soft' : rounded! > 0 ? 'text-accent' : 'text-danger'
            }`}
          >
            {formatSignedPct(series.deltaPct)}
          </p>
        )}
      </div>
      <Sparkline
        points={series.points}
        width={96}
        height={24}
        trend={rounded == null ? undefined : rounded < 0 ? 'down' : 'up'}
      />
    </div>
  )
}
