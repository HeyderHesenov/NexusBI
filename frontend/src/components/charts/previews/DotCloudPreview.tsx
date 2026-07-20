import type { ChartConfig } from '../../../types'
import { pickScatterAxes, type Row } from './previewData'

// Enough dots to show the shape; beyond this an 80px-tall preview is just noise.
const MAX_DOTS = 40
// Inset the cloud so dots at the extremes aren't half-clipped by the box.
const PAD_PCT = 5

/** Scatter collapses to the shape of its cloud — no axes, no ticks.
 *  Positioned in HTML rather than a stretched SVG: `preserveAspectRatio="none"`
 *  fills the fluid card width but would squash circles into ellipses, and
 *  `vectorEffect="non-scaling-size"` isn't reliably implemented. Percent-placed
 *  divs stay round at any container aspect.
 *  Assumes 2+ rows — ChartPreview guards that. */
export function DotCloudPreview({ data, config }: { data: Row[]; config: ChartConfig }) {
  const { x, y } = pickScatterAxes(data, config)
  const rows = data.slice(0, MAX_DOTS)
  const xs = rows.map((r) => Number(r[x]) || 0)
  const ys = rows.map((r) => Number(r[y]) || 0)

  // Guard /0 when every point shares an x (or y): a flat span sits on the mid-line.
  const pct = (v: number, vals: number[]) => {
    const min = Math.min(...vals)
    const span = Math.max(...vals) - min
    if (span === 0) return 50
    return PAD_PCT + ((v - min) / span) * (100 - PAD_PCT * 2)
  }

  return (
    <div className="relative h-20 w-full" aria-hidden="true">
      {rows.map((_, i) => (
        <span
          key={i}
          className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/75"
          // `top` grows downward — flip so bigger values sit higher.
          style={{ left: `${pct(xs[i], xs)}%`, top: `${100 - pct(ys[i], ys)}%` }}
        />
      ))}
    </div>
  )
}
