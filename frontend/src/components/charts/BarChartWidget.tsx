import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartConfig } from '../../types'
import { useChartTheme } from './theme'

const ANOMALY_FILL = '#EF4444'

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
  height?: number | string
  onPointClick?: (field: string, value: unknown) => void
  anomalyLabels?: Set<string>
}

export function BarChartWidget({ data, config, height = 320, onPointClick, anomalyLabels }: Props) {
  const { ACCENT, AXIS, GRID, tooltipItem, tooltipLabel, tooltipStyle } = useChartTheme()
  const x = config.x_axis ?? Object.keys(data[0] ?? {})[0]
  const y = config.y_axis ?? Object.keys(data[0] ?? {})[1]
  const hasAnomalies = !!anomalyLabels?.size
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
        <XAxis dataKey={x} stroke={AXIS} fontSize={12} tickLine={false} />
        <YAxis stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} />
        <Tooltip
          cursor={{ fill: 'rgba(14,159,110,0.10)' }}
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabel}
          itemStyle={tooltipItem}
        />
        <Bar
          dataKey={y}
          fill={ACCENT}
          radius={[6, 6, 0, 0]}
          maxBarSize={48}
          className={onPointClick ? 'cursor-pointer' : undefined}
          onClick={onPointClick ? (e: { [k: string]: unknown }) => onPointClick(x, e?.[x]) : undefined}
        >
          {hasAnomalies &&
            data.map((row, i) => (
              <Cell
                key={i}
                fill={anomalyLabels?.has(String(row[x])) ? ANOMALY_FILL : ACCENT}
              />
            ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
