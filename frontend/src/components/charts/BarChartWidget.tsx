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
// In scrollable mode we show far more bars (a right-side scrollbar reveals the
// rest) but still fold an extreme tail so the SVG stays performant.
const SCROLL_TOP_N = 60
const ROW_PX = 34 // vertical room per bar when the chart scrolls

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const fmt = (v: unknown) => (typeof v === 'number' ? compact.format(v) : String(v ?? ''))

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
  height?: number | string
  onPointClick?: (field: string, value: unknown) => void
  anomalyLabels?: Set<string>
  /** Show all bars in a fixed-height, right-scrollbar viewport (vs. folding
   *  hard to Top-14). Used in the explorable chart view, not dashboard cells. */
  scrollable?: boolean
}

/** Horizontal, value-sorted bars with end-of-bar value labels. Names sit on the
 *  Y axis (no rotation), the longest tail folds into one "Digər" bar, and every
 *  bar shares one calm emerald — length + label carry the meaning. */
export function BarChartWidget({
  data,
  config,
  height = 320,
  onPointClick,
  anomalyLabels,
  scrollable = false,
}: Props) {
  const { ACCENT, AXIS, GRID, tooltipItem, tooltipLabel, tooltipStyle } = useChartTheme()
  const x = config.x_axis ?? Object.keys(data[0] ?? {})[0]
  const y = config.y_axis ?? Object.keys(data[0] ?? {})[1]

  // Sort by value (a clean ranking, top-to-bottom) and fold the long tail of
  // high-cardinality results into one "Digər (k)" bar so the axis stays legible.
  // When scrollable, keep many more bars (the scrollbar reveals them) and only
  // fold an extreme tail for performance.
  const foldAfter = scrollable ? SCROLL_TOP_N : TOP_N
  const barData = useMemo(() => {
    const sorted = [...data].sort((a, b) => (Number(b[y]) || 0) - (Number(a[y]) || 0))
    if (sorted.length <= foldAfter + 1) return sorted
    const top = sorted.slice(0, foldAfter)
    const rest = sorted.slice(foldAfter)
    const restSum = rest.reduce((sum, row) => sum + (Number(row[y]) || 0), 0)
    return [...top, { [x]: `${OTHERS_LABEL} (${rest.length})`, [y]: restSum }]
  }, [data, x, y, foldAfter])

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

  // Scrollable: give the chart its natural height (one row per bar) so a
  // standard right-side scrollbar appears once the bars overflow the viewport.
  // `minHeight: 100%` makes a few bars still fill the box (no empty gap); many
  // bars push past it and scroll. Works for both the inline (px) and fullscreen
  // ('100%') heights.
  const intrinsicH = barData.length * ROW_PX + 48

  const inner = (
    <ResponsiveContainer width="100%" height={scrollable ? '100%' : height}>
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

  if (!scrollable) return inner
  return (
    <div style={{ height }} className="overflow-y-auto pr-1">
      <div style={{ minHeight: '100%', height: intrinsicH }}>{inner}</div>
    </div>
  )
}
