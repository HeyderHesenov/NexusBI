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
