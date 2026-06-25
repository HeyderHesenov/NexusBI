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

  const total = data.reduce((sum, row) => sum + (Number(row[value]) || 0), 0)

  const renderTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: { payload?: Record<string, unknown> }[]
  }) => {
    if (!active || !payload?.length) return null
    const row = payload[0].payload ?? {}
    const v = Number(row[value]) || 0
    const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0'
    return (
      <div style={{ ...tooltipStyle, padding: '8px 10px' }}>
        <div style={{ ...tooltipLabel, marginBottom: 2 }}>{String(row[name] ?? '')}</div>
        <div style={tooltipItem}>
          {v.toLocaleString()} ({pct}%)
        </div>
      </div>
    )
  }

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
        <Tooltip content={renderTooltip} />
        {showLegend && (
          <Legend wrapperStyle={{ fontSize: 12, color: 'rgb(var(--ink-soft))' }} />
        )}
      </PieChart>
    </ResponsiveContainer>
  )
}
