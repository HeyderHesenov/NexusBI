import type { ChartConfig } from '../../types'
import { BarChartWidget } from './BarChartWidget'
import { KPICard } from './KPICard'
import { LineChartWidget } from './LineChartWidget'
import { PieChartWidget } from './PieChartWidget'
import { TableWidget } from './TableWidget'

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
}

export function ChartRenderer({ data, config }: Props) {
  if (!data.length) {
    return <p className="text-ink-soft">Nəticə tapılmadı.</p>
  }
  switch (config.chart_type) {
    case 'bar':
      return <BarChartWidget data={data} config={config} />
    case 'line':
      return <LineChartWidget data={data} config={config} />
    case 'pie':
      return <PieChartWidget data={data} config={config} />
    case 'kpi_card':
      return <KPICard data={data} config={config} />
    case 'table':
    default:
      return <TableWidget data={data} />
  }
}
