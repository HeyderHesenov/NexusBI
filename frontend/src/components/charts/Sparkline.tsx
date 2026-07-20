import { DANGER, useChartTheme } from './theme'

interface Props {
  points: number[]
  width?: number
  height?: number
  /** Force the stroke color to a caller-decided direction so it can't contradict
   *  a companion delta chip (KPI cards compare last-vs-previous, not last-vs-first).
   *  Omitted → whole-series net trend (last vs first). */
  trend?: 'up' | 'down'
  /** Fill the parent instead of a fixed pixel box. `width`/`height` then only set
   *  the viewBox aspect. Chat share previews are fluid (~198px on a phone, ~264px
   *  on desktop), so a fixed-width svg would clip under the card's overflow-hidden. */
  responsive?: boolean
}

/** Tiny inline trend line (no axes/labels): accent when up, danger when down.
 *  Direction follows `trend` when given, else the series' net move (end vs start).
 *  Shared by KPI cards and the decision ROI cards. */
export function Sparkline({ points, width = 120, height = 28, trend, responsive }: Props) {
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
  // The fixed branch lets the stroke spill past the box (overflow-visible); the
  // responsive one can't — its parent clips — so pad the viewBox by half a stroke
  // instead, keeping the line whole at the extremes.
  const PAD = 1
  return (
    <svg
      {...(responsive
        ? {
            viewBox: `${-PAD} ${-PAD} ${width + PAD * 2} ${height + PAD * 2}`,
            preserveAspectRatio: 'none' as const,
            className: 'h-full w-full',
          }
        : { width, height, className: 'overflow-visible' })}
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke={up ? ACCENT : DANGER}
        strokeWidth={1.6}
        strokeLinecap="round"
        // preserveAspectRatio="none" scales x and y unequally, which would smear
        // the stroke itself — pin its width to user space.
        vectorEffect={responsive ? 'non-scaling-stroke' : undefined}
      />
    </svg>
  )
}
