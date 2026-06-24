import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { ChartConfig } from '../../types'
import { SERIES, tooltipLabel, tooltipStyle } from './theme'

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
  height?: number | string
}

export function PieChartWidget({ data, config, height = 320 }: Props) {
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
          stroke="#1A1C21"
          strokeWidth={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={SERIES[i % SERIES.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabel} />
      </PieChart>
    </ResponsiveContainer>
  )
}
