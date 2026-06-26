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
import { AngledTick, TruncatedTick } from './axis'
import { useChartTheme } from './theme'

const ANOMALY_FILL = '#EF4444'

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
  const { ACCENT, AXIS, GRID, tooltipItem, tooltipLabel, tooltipStyle } = useChartTheme()
  const x = config.x_axis ?? Object.keys(data[0] ?? {})[0]
  const y = config.y_axis ?? Object.keys(data[0] ?? {})[1]

  const cats = data.map((d) => String(d[x] ?? ''))
  const maxLen = cats.reduce((m, c) => Math.max(m, c.length), 0)
  const count = data.length
  // Long category names read far better as horizontal bars (labels on the Y
  // axis can't collide); short/sparse sets stay as upright columns.
  const horizontal = maxLen > 12 && count <= 14
  const showValues = count <= 6

  const hasAnomalies = !!anomalyLabels?.size
  const cells =
    hasAnomalies &&
    data.map((row, i) => (
      <Cell key={i} fill={anomalyLabels?.has(String(row[x])) ? ANOMALY_FILL : ACCENT} />
    ))

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
        onClick: (e: { [k: string]: unknown }) => onPointClick(x, e?.[x]),
      }
    : {}

  if (horizontal) {
    const yWidth = Math.min(180, Math.max(70, maxLen * 7 + 16))
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
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
      <BarChart data={data} margin={{ top: 16, right: 8, bottom: 8, left: 0 }} barCategoryGap="22%">
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
