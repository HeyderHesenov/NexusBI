import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartConfig } from '../../types'
import { useMemo } from 'react'
import { AngledTick, TruncatedTick } from './axis'
import { useChartTheme } from './theme'

const ANOMALY_FILL = '#EF4444'
const OTHERS_LABEL = 'Digər'
// Past this many bars the axis gets cluttered; keep the biggest TOP_N and fold
// the rest into one "Digər" bar. Small/ordered sets are left untouched.
const TOP_N = 14

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const fmt = (v: unknown) => (typeof v === 'number' ? compact.format(v) : String(v ?? ''))

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
  height?: number | string
  onPointClick?: (field: string, value: unknown) => void
  anomalyLabels?: Set<string>
}

export function BarChartWidget({ data, config, height = 320, onPointClick, anomalyLabels }: Props) {
  const { ACCENT, AXIS, GRID, BAR_MUTED, tooltipItem, tooltipLabel, tooltipStyle } = useChartTheme()
  const x = config.x_axis ?? Object.keys(data[0] ?? {})[0]
  const y = config.y_axis ?? Object.keys(data[0] ?? {})[1]

  // High-cardinality results are unreadable as dozens of thin bars. Sort by value
  // and fold the long tail into one "Digər (k)" bar. Small/ordered sets (e.g. a
  // few months) keep their original order so chronology isn't scrambled.
  const barData = useMemo(() => {
    if (data.length <= TOP_N + 1) return data
    const sorted = [...data].sort((a, b) => (Number(b[y]) || 0) - (Number(a[y]) || 0))
    const top = sorted.slice(0, TOP_N)
    const rest = sorted.slice(TOP_N)
    const restSum = rest.reduce((sum, row) => sum + (Number(row[y]) || 0), 0)
    return [...top, { [x]: `${OTHERS_LABEL} (${rest.length})`, [y]: restSum }]
  }, [data, x, y])

  const cats = barData.map((d) => String(d[x] ?? ''))
  const maxLen = cats.reduce((m, c) => Math.max(m, c.length), 0)
  const count = barData.length
  // Long category names read far better as horizontal bars (labels on the Y
  // axis can't collide); short/sparse sets stay as upright columns.
  const horizontal = maxLen > 12 && count <= 16
  const showValues = count <= 6

  // Highlight the leader: tallest bar(s) in accent emerald, the rest muted, so
  // the chart reads at a glance without every bar competing for attention.
  const isOthers = (label: unknown) => String(label ?? '').startsWith(OTHERS_LABEL)
  // Leader = the largest REAL category (the "Digər" aggregate can outweigh any
  // single category, but it must never be the highlighted bar).
  const realValues = barData.filter((d) => !isOthers(d[x])).map((d) => Number(d[y]) || 0)
  const max = realValues.length ? Math.max(...realValues) : Infinity
  const barFill = (row: Record<string, unknown>) => {
    if (anomalyLabels?.has(String(row[x]))) return ANOMALY_FILL
    if (isOthers(row[x])) return BAR_MUTED
    return (Number(row[y]) || 0) === max ? ACCENT : BAR_MUTED
  }
  const cells = barData.map((row, i) => <Cell key={i} fill={barFill(row)} />)

  const tooltip = (
    <Tooltip
      cursor={{ fill: 'rgba(14,159,110,0.10)' }}
      contentStyle={tooltipStyle}
      labelStyle={tooltipLabel}
      itemStyle={tooltipItem}
    />
  )
  const clickProps = onPointClick
    ? {
        className: 'cursor-pointer',
        onClick: (e: { [k: string]: unknown }) => {
          // The synthetic "Digər" bar isn't a real category → no drill-down.
          if (!isOthers(e?.[x])) onPointClick(x, e?.[x])
        },
      }
    : {}

  if (horizontal) {
    const yWidth = Math.min(180, Math.max(70, maxLen * 7 + 16))
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={barData} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke={GRID} horizontal={false} />
          <XAxis type="number" stroke={AXIS} fontSize={12} tickLine={false} tickFormatter={fmt} />
          <YAxis
            type="category"
            dataKey={x}
            stroke={AXIS}
            tickLine={false}
            axisLine={false}
            width={yWidth}
            interval={0}
            tick={<TruncatedTick max={20} anchor="end" />}
          />
          {tooltip}
          <Bar dataKey={y} fill={ACCENT} radius={[0, 6, 6, 0]} maxBarSize={26} {...clickProps}>
            {cells}
            {showValues && <LabelList dataKey={y} position="right" fontSize={11} fill={AXIS} formatter={fmt} />}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={barData} margin={{ top: 16, right: 8, bottom: 8, left: 0 }} barCategoryGap="22%">
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
        <XAxis
          dataKey={x}
          stroke={AXIS}
          tickLine={false}
          interval={0}
          height={maxLen > 6 ? 56 : 24}
          tick={maxLen > 6 ? <AngledTick max={14} /> : { fontSize: 12, fill: AXIS }}
        />
        <YAxis stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} tickFormatter={fmt} />
        {tooltip}
        <Bar dataKey={y} fill={ACCENT} radius={[6, 6, 0, 0]} maxBarSize={56} {...clickProps}>
          {cells}
          {showValues && <LabelList dataKey={y} position="top" fontSize={11} fill={AXIS} formatter={fmt} />}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
