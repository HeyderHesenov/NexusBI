import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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

// Past this many slices a pie is unreadable; keep the biggest TOP_N and fold the
// rest into a single "Digər" slice (only when it would merge 2+ slices).
const TOP_N = 8

export function PieChartWidget({
  data,
  config,
  height = 320,
  showLegend = false,
  onPointClick,
}: Props) {
  const { t } = useTranslation()
  const { SERIES, tooltipItem, tooltipLabel, tooltipStyle } = useChartTheme()
  const name = config.x_axis ?? Object.keys(data[0] ?? {})[0]
  const value = config.y_axis ?? Object.keys(data[0] ?? {})[1]
  const othersLabel = t('pieChartWidget.others')

  // Sort by value desc; collapse the long tail into one "Digər (k)" slice so the
  // donut stays legible. The summed value is preserved → percentages stay exact.
  const pieData = useMemo(() => {
    const sorted = [...data].sort((a, b) => (Number(b[value]) || 0) - (Number(a[value]) || 0))
    if (sorted.length <= TOP_N + 1) return sorted
    const top = sorted.slice(0, TOP_N)
    const rest = sorted.slice(TOP_N)
    const restSum = rest.reduce((sum, row) => sum + (Number(row[value]) || 0), 0)
    return [...top, { [name]: t('pieChartWidget.othersWithCount', { count: rest.length }), [value]: restSum }]
  }, [data, name, value, t])

  const total = pieData.reduce((sum, row) => sum + (Number(row[value]) || 0), 0)
  const isOthers = (label: unknown) => String(label ?? '').startsWith(othersLabel)

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
        <div style={{ ...tooltipLabel, marginBottom: 2 }}>{value}</div>
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
          data={pieData}
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
              ? (e: { payload?: Record<string, unknown> }) => {
                  const v = e?.payload?.[name]
                  // The synthetic "Digər" slice isn't a real value → no drill-down.
                  if (!isOthers(v)) onPointClick(name, v)
                }
              : undefined
          }
        >
          {pieData.map((row, i) => (
            <Cell
              key={i}
              fill={isOthers(row[name]) ? 'rgb(var(--ink-faint))' : SERIES[i % SERIES.length]}
            />
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
