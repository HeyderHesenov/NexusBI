import type { CSSProperties } from 'react'
import type { Widget } from '../../types'
import { ChartRenderer } from '../charts/LazyChartRenderer'

/**
 * Read-only widget grid for the public share + embed pages. Reproduces the
 * owner's saved react-grid-layout composition ("lg" breakpoint) as a pure CSS
 * 12-column grid — no react-grid-layout import, no interactivity — so the
 * audience sees the arrangement the owner actually designed instead of a
 * uniform 2-column wall of identical boxes.
 */

type LgEntry = { i: string; x: number; y: number; w: number; h: number }

// Geometry MUST mirror DashboardGrid.tsx (rowHeight / margin), so that a cell
// spanning h rows renders exactly h*34 + (h-1)*16 px — pixel-identical to the
// owner's authenticated view.
const ROW = 34
const GAP = 16 // container gap-4 below must stay 16px to preserve the identity

// TAILWIND JIT GUARD: these must remain single literal strings in source —
// interpolating them per-widget would drop the classes from the build and
// silently collapse every card to auto-flow.
const PLACE = 'md:[grid-column:var(--gc)] md:[grid-row:var(--gr)]'
const CELL_H = 'h-[clamp(15rem,var(--hpx),28rem)] md:h-auto'

interface Placed {
  widget: Widget
  style: CSSProperties
  reveal: string
}

function place(widgets: Widget[], layout: Record<string, unknown> | null): Placed[] {
  const ids = new Set(widgets.map((w) => w.id))
  // Stored layout JSON crosses a trust boundary: drop stale ids and non-finite
  // coords, clamp into the 12-column grid.
  const saved = ((layout as { lg?: LgEntry[] } | null)?.lg ?? [])
    .filter(
      (l): l is LgEntry =>
        !!l &&
        typeof l.i === 'string' &&
        ids.has(l.i) &&
        [l.x, l.y, l.w, l.h].every((n) => Number.isFinite(n)),
    )
    .map((l) => {
      const x = Math.min(Math.max(Math.round(l.x), 0), 11)
      return {
        i: l.i,
        x,
        y: Math.max(Math.round(l.y), 0),
        w: Math.min(Math.max(Math.round(l.w), 1), 12 - x),
        h: Math.max(Math.round(l.h), 1),
      }
    })
  const byId = new Map(saved.map((l) => [l.i, l]))
  // Widgets without a saved slot append BELOW the composition in the authed
  // 6-wide/9-tall fallback shape. CSS grid has no collision solver, so a
  // fallback must never guess into occupied space — appending below is always
  // safe and keeps the owner's arrangement for every widget that has a slot.
  const baseY = saved.reduce((m, l) => Math.max(m, l.y + l.h), 0)
  let j = 0
  const cells = widgets.map((w) => ({
    w,
    l: byId.get(w.id) ?? { i: w.id, x: (j % 2) * 6, y: baseY + Math.floor(j++ / 2) * 9, w: 6, h: 9 },
  }))
  // DOM order = visual reading order: drives tab order, the <md single-column
  // stack, and the reveal stagger. Explicit placement wins at md+ regardless.
  cells.sort((a, b) => a.l.y - b.l.y || a.l.x - b.l.x)
  return cells.map(({ w, l }, i) => ({
    widget: w,
    reveal: `reveal reveal-d${Math.min(i + 1, 6)}`,
    style: {
      // Whole grid-line values live in the vars so the class strings above can
      // stay static (no span-inside-shorthand JIT edge cases).
      '--gc': `${l.x + 1} / span ${l.w}`,
      '--gr': `${l.y + 1} / span ${l.h}`,
      // Exact RGL-rendered height, consumed only <md and clamped 240–448px so
      // a tall hero chart doesn't become a phone wall.
      '--hpx': `${l.h * ROW + (l.h - 1) * GAP}px`,
    } as CSSProperties,
  }))
}

interface Props {
  widgets: Widget[]
  layout: Record<string, unknown> | null
  /** Page-scoped t() results — the component stays i18n-agnostic. */
  widgetFallback: string
  noResult: string
}

export function PublicWidgetGrid({ widgets, layout, widgetFallback, noResult }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-12 md:auto-rows-[34px]">
      {place(widgets, layout).map(({ widget: w, style, reveal }) => {
        const title = w.title || w.chart?.natural_language || widgetFallback
        const kind = w.chart?.chart_config.chart_type

        if (kind === 'kpi_card' && w.chart && w.chart.data.length > 0) {
          // Frameless KPI: KPICard already renders a finished designed tile
          // (surface-2, plot-grid, its own eyebrow + border) — wrapping it in a
          // second card is the double-frame the redesign kills. The grid
          // wrapper's default stretch makes the tile fill the cell exactly,
          // with zero KPICard edits; its internal eyebrow is the visible title.
          return (
            <div key={w.id} style={style} title={title} className={`${reveal} grid min-w-0 ${CELL_H} ${PLACE}`}>
              <span className="sr-only">{title}</span>
              <ChartRenderer data={w.chart.data} config={w.chart.chart_config} height="100%" />
            </div>
          )
        }

        // House card grammar (TwinPage recipe): eyebrow title inside the
        // padding — no bordered title bar. The table-only direct-child override
        // lets TableWidget's max-h-96 scroll well fill tall owner-sized cells;
        // it must NOT widen to pivots (PivotWidget's well is nested in an
        // auto-height stack where max-height:100% resolves to none → would
        // uncap its scroll and clip content under overflow-hidden).
        return (
          <article
            key={w.id}
            style={style}
            className={`${reveal} flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-card ${CELL_H} ${PLACE}`}
          >
            <h2 title={title} className="eyebrow mb-3 shrink-0 truncate">
              {title}
            </h2>
            <div className={`min-h-0 flex-1${kind === 'table' ? ' [&>div]:max-h-full' : ''}`}>
              {w.chart && w.chart.data.length > 0 ? (
                <ChartRenderer data={w.chart.data} config={w.chart.chart_config} height="100%" />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-ink-faint">
                  {noResult}
                </div>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
