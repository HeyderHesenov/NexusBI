import type { ChartConfig } from '../../../types'
import { BarListPreview } from './BarListPreview'
import { DonutPreview } from './DonutPreview'
import { DotCloudPreview } from './DotCloudPreview'
import { KpiTilePreview } from './KpiTilePreview'
import { TableSummaryPreview } from './TableSummaryPreview'
import { TrendPreview } from './TrendPreview'
import { pickSeries, valueTotal, type Row } from './previewData'

export interface ChartPreviewProps {
  data: Row[]
  config: ChartConfig
  /** Column order from the snapshot; falls back to the first row's keys. */
  columns?: string[]
}

/** ChartRenderer's lightweight twin: same `{data, config}` in, a glanceable
 *  summary out — and crucially NO recharts. A chat thread mounts one of these per
 *  shared chart, and pulling the ~440kB chart bundle in (plus a ResizeObserver per
 *  card) to paint a 288px thumbnail is a cost the thread shouldn't carry. The real
 *  chart is one click away in ShareChartModal — that's where recharts loads.
 *
 *  This is also the single place that decides whether a family preview is viable.
 *  The sub-previews assume good input; degenerate data (one row, an all-zero or
 *  missing value column) falls back to the table summary rather than rendering an
 *  empty box — the card wraps this in a button, and a blank button is a trap. */
export function ChartPreview({ data, config, columns }: ChartPreviewProps) {
  if (!data.length) return null
  const summary = <TableSummaryPreview data={data} columns={columns} />

  switch (config.chart_type) {
    case 'kpi_card':
      // Renders "—" rather than nothing when there's no latest value.
      return <KpiTilePreview data={data} config={config} />
    case 'bar':
      return valueTotal(data, config) > 0 ? (
        <BarListPreview data={data} config={config} />
      ) : (
        summary
      )
    case 'pie':
      return valueTotal(data, config) > 0 ? <DonutPreview data={data} config={config} /> : summary
    case 'line':
    case 'area':
      return pickSeries(data, config).length >= 2 ? (
        <TrendPreview data={data} config={config} />
      ) : (
        summary
      )
    case 'scatter':
      return data.length >= 2 ? <DotCloudPreview data={data} config={config} /> : summary
    case 'table':
    case 'pivot':
    default:
      // `default` also catches chart types newer than this client build, mirroring
      // ShareCard's `TYPE_ICONS[…] ?? Share2` fallback.
      return summary
  }
}
