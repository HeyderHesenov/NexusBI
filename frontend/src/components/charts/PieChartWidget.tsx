import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { ChartConfig } from '../../types'

const COLORS = ['#14b8a6', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#ec4899']

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
}

export function PieChartWidget({ data, config }: Props) {
  const name = config.x_axis ?? Object.keys(data[0] ?? {})[0]
  const value = config.y_axis ?? Object.keys(data[0] ?? {})[1]
  return (
    <ResponsiveContainer width="100%" height={320}>
      <PieChart>
        <Pie data={data} dataKey={value} nameKey={name} outerRadius={120} label>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ background: '#1e293b', border: 'none' }} />
      </PieChart>
    </ResponsiveContainer>
  )
}
