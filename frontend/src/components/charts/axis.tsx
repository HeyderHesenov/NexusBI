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
  const { INK_SOFT } = useChartTheme()
  const label = String(payload?.value ?? '')
  return (
    <text x={x} y={y} dy={4} textAnchor={anchor} fontSize={12} fill={INK_SOFT}>
      {truncate(label, max)}
    </text>
  )
}

/** A 35°-rotated, truncated X tick — keeps long category names from colliding. */
export function AngledTick({ x = 0, y = 0, payload, max = 14 }: TickProps) {
  const { INK_SOFT } = useChartTheme()
  const label = String(payload?.value ?? '')
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={10} textAnchor="end" transform="rotate(-35)" fontSize={12} fill={INK_SOFT}>
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

/**
 * The two colors an axis needs, kept apart because they answer to different
 * WCAG rules.
 *
 * recharts defaults the tick TEXT fill to the axis `stroke`
 * (`CartesianAxis.renderTicks`: `{ …axisProps, stroke: 'none', fill: stroke }`),
 * so a single color would drag the labels down to whatever reads well as a
 * rule. `AXIS` measures 3.24–4.02 — fine for a 1px line at the 3:1 non-text
 * floor, a failure for 11–12px text at 4.5:1. An explicit `tick.fill` lands
 * after `fill: stroke` in that spread and wins.
 *
 * Passed as one object rather than two positional strings: both are `string`,
 * so a swapped pair would type-check and silently undo the fix.
 */
export interface AxisColors {
  /** The rule and its tick marks — a graphic, judged at 3:1. */
  axis: string
  /** Tick labels and the axis title — text, judged at 4.5:1. */
  inkSoft: string
}

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
  { axis, inkSoft }: AxisColors,
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
    tick: longX ? <TruncatedTick max={10} anchor="middle" /> : { fontSize: 12, fill: inkSoft },
    label: label
      ? { value: label, position: 'insideBottom' as const, offset: -12, fontSize: 11, fill: inkSoft }
      : undefined,
  }
}

/** Y-axis config shared byte-for-byte by the Line and Area widgets: a value axis
 *  whose ticks run through the chart's own value formatter. */
export function valueYAxisProps(
  { axis, inkSoft }: AxisColors,
  fmt: (n: number) => string,
  label: string | null | undefined,
) {
  return {
    stroke: axis,
    fontSize: 12,
    tickLine: false,
    axisLine: false,
    tickFormatter: (v: number | string) => fmt(Number(v)),
    tick: { fontSize: 12, fill: inkSoft },
    label: label
      ? {
          value: label,
          angle: -90 as const,
          position: 'insideLeft' as const,
          fontSize: 11,
          fill: inkSoft,
        }
      : undefined,
  }
}
