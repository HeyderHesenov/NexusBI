import type { ChartConfig } from '../../types'
import { AreaChartWidget } from './AreaChartWidget'
import { BarChartWidget } from './BarChartWidget'
import { KPICard } from './KPICard'
import { LineChartWidget } from './LineChartWidget'
import { PieChartWidget } from './PieChartWidget'
import { ScatterChartWidget } from './ScatterChartWidget'
import { TableWidget } from './TableWidget'

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
  /** Chart height — number (px) or '100%' to fill a sized parent. */
  height?: number | string
  showLegend?: boolean
  /** Drill-down: fired when a chart element is clicked (categorical charts). */
  onPointClick?: (field: string, value: unknown) => void
}

export function ChartRenderer({
  data,
  config,
  height = 320,
  showLegend = false,
  onPointClick,
}: Props) {
  if (!data.length) {
    return <p className="text-ink-soft">Nəticə tapılmadı.</p>
  }
  switch (config.chart_type) {
    case 'bar':
      return <BarChartWidget data={data} config={config} height={height} onPointClick={onPointClick} />
    case 'line':
      return <LineChartWidget data={data} config={config} height={height} />
    case 'area':
      return <AreaChartWidget data={data} config={config} height={height} />
    case 'pie':
      return (
        <PieChartWidget
          data={data}
          config={config}
          height={height}
          showLegend={showLegend}
          onPointClick={onPointClick}
        />
      )
    case 'scatter':
      return <ScatterChartWidget data={data} config={config} height={height} onPointClick={onPointClick} />
    case 'kpi_card':
      return <KPICard data={data} config={config} />
    case 'table':
    default:
      return <TableWidget data={data} />
  }
}
