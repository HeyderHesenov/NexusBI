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
import { useMemo } from 'react'
import type { ChartConfig } from '../../types'
import { TruncatedTick } from './axis'
import { useChartTheme } from './theme'

const ANOMALY_FILL = '#EF4444'
const OTHERS_LABEL = 'Digər'
// Past this many bars the axis gets cluttered; keep the biggest TOP_N and fold
// the rest into one "Digər" bar. Small sets are simply sorted, not folded.
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

/** Horizontal, value-sorted bars with end-of-bar value labels. Names sit on the
 *  Y axis (no rotation), the longest tail folds into one "Digər" bar, and every
 *  bar shares one calm emerald — length + label carry the meaning. */
export function BarChartWidget({ data, config, height = 320, onPointClick, anomalyLabels }: Props) {
  const { ACCENT, AXIS, GRID, tooltipItem, tooltipLabel, tooltipStyle } = useChartTheme()
  const x = config.x_axis ?? Object.keys(data[0] ?? {})[0]
  const y = config.y_axis ?? Object.keys(data[0] ?? {})[1]

  // Sort by value (a clean ranking, top-to-bottom) and fold the long tail of
  // high-cardinality results into one "Digər (k)" bar so the axis stays legible.
  const barData = useMemo(() => {
    const sorted = [...data].sort((a, b) => (Number(b[y]) || 0) - (Number(a[y]) || 0))
    if (sorted.length <= TOP_N + 1) return sorted
    const top = sorted.slice(0, TOP_N)
    const rest = sorted.slice(TOP_N)
    const restSum = rest.reduce((sum, row) => sum + (Number(row[y]) || 0), 0)
    return [...top, { [x]: `${OTHERS_LABEL} (${rest.length})`, [y]: restSum }]
  }, [data, x, y])

  const isOthers = (label: unknown) => String(label ?? '').startsWith(OTHERS_LABEL)
  const maxLen = barData.reduce((m, d) => Math.max(m, String(d[x] ?? '').length), 0)
  const yWidth = Math.min(190, Math.max(72, maxLen * 7 + 16))

  const clickProps = onPointClick
    ? {
        className: 'cursor-pointer',
        onClick: (e: { [k: string]: unknown }) => {
          // The synthetic "Digər" bar isn't a real category → no drill-down.
          if (!isOthers(e?.[x])) onPointClick(x, e?.[x])
        },
      }
    : {}

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={barData} layout="vertical" margin={{ top: 8, right: 52, bottom: 0, left: 0 }}>
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
          tick={<TruncatedTick max={22} anchor="end" />}
        />
        <Tooltip
          cursor={{ fill: 'rgba(14,159,110,0.10)' }}
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabel}
          itemStyle={tooltipItem}
        />
        <Bar dataKey={y} fill={ACCENT} radius={[0, 6, 6, 0]} maxBarSize={28} {...clickProps}>
          {anomalyLabels?.size
            ? barData.map((row, i) => (
                <Cell key={i} fill={anomalyLabels.has(String(row[x])) ? ANOMALY_FILL : ACCENT} />
              ))
            : null}
          <LabelList dataKey={y} position="right" fontSize={11} fill={AXIS} formatter={fmt} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
