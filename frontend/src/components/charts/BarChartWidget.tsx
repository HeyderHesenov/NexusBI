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
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChartConfig } from '../../types'
import { useFormatNumber } from '../../hooks/useFormatNumber'
import { TruncatedTick } from './axis'
import { ScrollZoom } from './ScrollZoom'
import { useChartTheme } from './theme'

const ANOMALY_FILL = '#EF4444'
// Past this many bars the axis gets cluttered; keep the biggest TOP_N and fold
// the rest into one "Digər" bar. Small sets are simply sorted, not folded.
const TOP_N = 14
// In scrollable mode we show far more bars (a right-side scrollbar reveals the
// rest) but still fold an extreme tail so the SVG stays performant.
const SCROLL_TOP_N = 60
const ROW_PX = 34 // vertical room per bar when the chart scrolls

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
  const { t } = useTranslation()
  const fmtNum = useFormatNumber()
  const fmt = useCallback(
    (v: unknown) => (typeof v === 'number' ? fmtNum(v, { compact: true }) : String(v ?? '')),
    [fmtNum],
  )
  const { ACCENT, AXIS, GRID, tooltipItem, tooltipLabel, tooltipStyle } = useChartTheme()
  const othersLabel = t('barChartWidget.othersLabel')
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
    return [...top, { [x]: t('barChartWidget.others', { n: rest.length }), [y]: restSum }]
  }, [data, x, y, foldAfter, t])

  const isOthers = (label: unknown) => String(label ?? '').startsWith(othersLabel)
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

  // `zoom` only applies in scrollable mode (magnify via ScrollZoom): it scales
  // each bar's height and thickness so you can enlarge columns while the
  // scrollbar still reaches all of them. Non-scrollable callers render at zoom 1.
  const renderChart = (chartHeight: number | string, zoom: number) => (
    <ResponsiveContainer width="100%" height={chartHeight}>
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
        <Bar
          dataKey={y}
          fill={ACCENT}
          radius={[0, 6, 6, 0]}
          maxBarSize={Math.round(28 * zoom)}
          {...clickProps}
        >
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

  if (!scrollable) return renderChart(height, 1)

  // Scrollable: the chart takes its natural height (one row per bar, scaled by
  // zoom) inside a fixed-height viewport so a standard right-side scrollbar
  // appears once the bars overflow. `minHeight: 100%` keeps a few bars filling
  // the box (no empty gap). ScrollZoom owns scroll + magnify + drag-pan.
  return (
    <ScrollZoom height={height}>
      {(zoom) => (
        <div style={{ minHeight: '100%', height: barData.length * ROW_PX * zoom + 48 }}>
          {renderChart('100%', zoom)}
        </div>
      )}
    </ScrollZoom>
  )
}
