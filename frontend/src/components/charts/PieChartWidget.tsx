import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { ChartConfig } from '../../types'
import { useChartTheme } from './theme'

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
  height?: number | string
  showLegend?: boolean
  onPointClick?: (field: string, value: unknown) => void
}

export function PieChartWidget({
  data,
  config,
  height = 320,
  showLegend = false,
  onPointClick,
}: Props) {
  const { SERIES, tooltipItem, tooltipLabel, tooltipStyle } = useChartTheme()
  const name = config.x_axis ?? Object.keys(data[0] ?? {})[0]
  const value = config.y_axis ?? Object.keys(data[0] ?? {})[1]
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey={value}
          nameKey={name}
          innerRadius={62}
          outerRadius={118}
          paddingAngle={2}
          stroke="rgb(var(--surface))"
          strokeWidth={2}
          className={onPointClick ? 'cursor-pointer' : undefined}
          onClick={
            onPointClick
              ? (e: { payload?: Record<string, unknown> }) => onPointClick(name, e?.payload?.[name])
              : undefined
          }
        >
          {data.map((_, i) => (
            <Cell key={i} fill={SERIES[i % SERIES.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabel}
          itemStyle={tooltipItem}
        />
        {showLegend && (
          <Legend wrapperStyle={{ fontSize: 12, color: 'rgb(var(--ink-soft))' }} />
        )}
      </PieChart>
    </ResponsiveContainer>
  )
}
