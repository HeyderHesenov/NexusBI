import { DANGER, useChartTheme } from './theme'

interface Props {
  points: number[]
  width?: number
  height?: number
  /** Force the stroke color to a caller-decided direction so it can't contradict
   *  a companion delta chip (KPI cards compare last-vs-previous, not last-vs-first).
   *  Omitted → whole-series net trend (last vs first). */
  trend?: 'up' | 'down'
}

/** Tiny inline trend line (no axes/labels): accent when up, danger when down.
 *  Direction follows `trend` when given, else the series' net move (end vs start).
 *  Shared by KPI cards and the decision ROI cards. */
export function Sparkline({ points, width = 120, height = 28, trend }: Props) {
  const { ACCENT } = useChartTheme()
  if (points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const path = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * width
      const y = height - ((v - min) / span) * height
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const up = trend ? trend === 'up' : points[points.length - 1] >= points[0]
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke={up ? ACCENT : DANGER}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  )
}
