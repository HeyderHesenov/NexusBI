import { useChartTheme } from './theme'

/** Shorten a label with an ellipsis so axis ticks never overlap. */
export function truncate(label: string, max = 14): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

interface TickProps {
  x?: number
  y?: number
  payload?: { value?: unknown }
  /** Max characters before truncation. */
  max?: number
  /** Horizontal anchor for the text. */
  anchor?: 'start' | 'middle' | 'end'
}

/** A straight, truncated axis tick (used for Y category labels and time axes). */
export function TruncatedTick({ x = 0, y = 0, payload, max = 16, anchor = 'end' }: TickProps) {
  const { AXIS } = useChartTheme()
  const label = String(payload?.value ?? '')
  return (
    <text x={x} y={y} dy={4} textAnchor={anchor} fontSize={12} fill={AXIS}>
      {truncate(label, max)}
    </text>
  )
}

/** A 35°-rotated, truncated X tick — keeps long category names from colliding. */
export function AngledTick({ x = 0, y = 0, payload, max = 14 }: TickProps) {
  const { AXIS } = useChartTheme()
  const label = String(payload?.value ?? '')
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={10} textAnchor="end" transform="rotate(-35)" fontSize={12} fill={AXIS}>
        {truncate(label, max)}
      </text>
    </g>
  )
}

// --- Shared chart-frame prop builders -------------------------------------
// These return plain props objects spread onto the REAL recharts elements
// (<Tooltip>/<XAxis>/<YAxis>). recharts detects chart children by their element
// type, so we must not wrap them in custom components — spreading a props object
// keeps the element type intact while removing the copy-pasted config.

type TooltipStyle = Record<string, unknown>

/** The three shared <Tooltip> style props (content/label/item). Used by every
 *  cartesian widget; the per-widget `formatter` is passed separately. */
export function tooltipStyleProps(
  tooltipStyle: TooltipStyle,
  tooltipLabel: TooltipStyle,
  tooltipItem: TooltipStyle,
) {
  return { contentStyle: tooltipStyle, labelStyle: tooltipLabel, itemStyle: tooltipItem }
}

/** X-axis config shared byte-for-byte by the Line and Area time-series widgets:
 *  a category axis that truncates long labels and preserves the first/last tick. */
export function timeSeriesXAxisProps(
  axis: string,
  dataKey: string,
  label: string | null | undefined,
  longX: boolean,
) {
  return {
    dataKey,
    stroke: axis,
    tickLine: false,
    interval: 'preserveStartEnd' as const,
    minTickGap: 24,
    tick: longX ? <TruncatedTick max={10} anchor="middle" /> : { fontSize: 12, fill: axis },
    label: label
      ? { value: label, position: 'insideBottom' as const, offset: -12, fontSize: 11, fill: axis }
      : undefined,
  }
}

/** Y-axis config shared byte-for-byte by the Line and Area widgets: a value axis
 *  whose ticks run through the chart's own value formatter. */
export function valueYAxisProps(
  axis: string,
  fmt: (n: number) => string,
  label: string | null | undefined,
) {
  return {
    stroke: axis,
    fontSize: 12,
    tickLine: false,
    axisLine: false,
    tickFormatter: (v: number | string) => fmt(Number(v)),
    label: label
      ? { value: label, angle: -90 as const, position: 'insideLeft' as const, fontSize: 11, fill: axis }
      : undefined,
  }
}
