import { useTranslation } from 'react-i18next'
import type { ChartConfig } from '../../../types'
import { useChartTheme } from '../theme'
import { foldOther, type Row } from './previewData'

// The real donut folds at 8 (PieChartWidget.tsx:18); at preview size 4 arcs plus
// the tail is as much as reads.
const TOP_N = 4
const LABELS = 3
const R = 42
const STROKE = 16
const CIRC = 2 * Math.PI * R
/**
 * Gap between segments, in path units.
 *
 * The real donut separates its slices with `paddingAngle` plus a surface-colored
 * stroke; this one drew them edge to edge, so two neighbours met with nothing
 * between them. Adjacent series colours sit 1.05–1.49:1 apart — nowhere near the
 * 3:1 that would let the boundary read as a boundary — so the gap is what makes
 * one slice end and the next begin.
 */
const GAP = 2

/** Mini donut + top-3 labels. Arc <path> math degenerates at 360° (a lone 100%
 *  slice becomes a zero-length arc), so slices are stroke-dash segments on one
 *  circle instead — correct at both edges and far less code.
 *  Assumes a positive value total — ChartPreview guards that. */
export function DonutPreview({ data, config }: { data: Row[]; config: ChartConfig }) {
  const { t } = useTranslation()
  const { SERIES, INK_FAINT } = useChartTheme()
  const slices = foldOther(data, config, TOP_N, (count) =>
    t('pieChartWidget.othersWithCount', { count }),
  )
  const total = slices.reduce((sum, s) => sum + Math.abs(s.value), 0)

  const color = (s: (typeof slices)[number], i: number) =>
    s.isOther ? INK_FAINT : SERIES[i % SERIES.length]

  // Always name the folded wedge when there is one — a grey arc nobody accounts
  // for reads as a rendering bug. It takes the last label slot: top-2 + "Digər (k)".
  const other = slices.find((s) => s.isOther)
  const labelled = other ? [...slices.slice(0, LABELS - 1), other] : slices.slice(0, LABELS)

  let offset = 0
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0" aria-hidden="true">
        {/* -90° so the first slice starts at 12 o'clock, like the real donut. */}
        <g transform="rotate(-90 50 50)">
          {slices.map((s, i) => {
            // A single 100% slice keeps the full circumference: subtracting a gap
            // there would open a notch in what is visually one unbroken ring.
            const raw = (Math.abs(s.value) / total) * CIRC
            const len = slices.length > 1 ? Math.max(raw - GAP, 0.5) : raw
            const el = (
              <circle
                key={i}
                cx={50}
                cy={50}
                r={R}
                fill="none"
                stroke={color(s, i)}
                strokeWidth={STROKE}
                strokeDasharray={`${len} ${CIRC - len}`}
                strokeDashoffset={-offset}
              />
            )
            // Advance by the TRUE arc, not the shortened one: the gap is taken
            // out of what each segment paints, not out of the angle it owns.
            // Accumulating `len` here would walk every slice after the first
            // backwards by one gap and leave a wedge of blank ring at the end.
            offset += raw
            return el
          })}
        </g>
      </svg>
      {/* A bare donut reads as decoration — the labels make it data. */}
      <ul className="min-w-0 flex-1 space-y-1">
        {labelled.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5 text-[10px]">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: color(s, i) }}
            />
            <span className="min-w-0 flex-1 truncate text-ink-soft" title={s.label}>
              {s.label}
            </span>
            <span className="shrink-0 font-medium tabular-nums text-ink">
              {Math.round((Math.abs(s.value) / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
