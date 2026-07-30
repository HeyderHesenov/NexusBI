import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { isImageExportable } from '../../lib/chartExport'
import type { Dashboard } from '../../types'
import { ChartRenderer } from '../charts/LazyChartRenderer'

/**
 * A paper rendering of a dashboard, mounted only while a print is in flight.
 *
 * Why this exists instead of print styles over the live grid: react-grid-layout
 * positions cells with inline transforms and pixel heights, and recharts sizes
 * itself from its container through a ResizeObserver. Overriding the grid inside
 * `@media print` changes nothing on screen, so that observer never fires and the
 * charts print at their old size — or as skeletons. Here every block declares its
 * height up front, so what the browser measures on screen is what it prints.
 *
 * The sheet is portaled to <body> and laid out off-screen (NOT display:none,
 * which would give recharts a zero-size box to measure). `@media print` in
 * index.css hides #root and brings this back into flow.
 */

/** Fits the printable width of A4 *and* Letter in landscape (~949px at 96dpi). */
const SHEET_W = 940
const CHART_H = 400
/** KPI cards are a single number — a chart's worth of paper would be waste. */
const KPI_H = 180
/** Ceiling on how long we wait for charts to lay out before printing anyway. */
const SETTLE_MS = 1500

interface Props {
  dashboard: Dashboard
  /** Fired once, when the charts have painted and it is safe to print. */
  onReady: () => void
}

export function DashboardPrintView({ dashboard, onReady }: Props) {
  const { t } = useTranslation()
  const sheetRef = useRef<HTMLDivElement>(null)
  const firedRef = useRef(false)
  // The deadline belongs to the mount, not to the effect run. A live-mode board
  // hands us a new `dashboard` object on every refresh, and re-running the effect
  // would restart the clock each time — pushing the print further out exactly
  // when the user is waiting for it.
  const startedAtRef = useRef(0)
  if (!startedAtRef.current) startedAtRef.current = performance.now()
  // Read through a ref so a re-created callback can't re-arm the print.
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  // Wait for the recharts surfaces to exist rather than guessing a delay: their
  // container measurement is async, and printing a half-laid-out sheet is the
  // one failure the user cannot undo. SETTLE_MS bounds the wait either way.
  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet || firedRef.current) return
    const expected = dashboard.widgets.filter(
      (w) => w.chart?.data.length && isImageExportable(w.chart.chart_config.chart_type),
    ).length
    let raf = 0
    const tick = () => {
      const drawn = sheet.querySelectorAll('svg.recharts-surface').length
      if (drawn >= expected || performance.now() - startedAtRef.current > SETTLE_MS) {
        firedRef.current = true
        onReadyRef.current()
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [dashboard])

  return createPortal(
    <div
      ref={sheetRef}
      data-testid="print-sheet"
      // Off-screen but still laid out, so recharts has a real box to measure.
      // print:static returns it to the flow once #root is hidden.
      className="print-sheet fixed top-0 left-[-300vw] bg-white text-ink print:static print:left-0"
      style={{ width: SHEET_W }}
      // A duplicate of content already on the page — keep it out of the a11y tree.
      aria-hidden="true"
    >
      <header className="mb-6 border-b border-line pb-3">
        <h1 className="font-display text-2xl font-bold text-ink">{dashboard.name}</h1>
        <p className="mt-1 text-xs text-ink-soft">
          {t('dashboardPage.printedOn', { date: new Date().toLocaleDateString() })}
        </p>
      </header>

      {dashboard.widgets.map((w) => {
        const kind = w.chart?.chart_config.chart_type
        return (
          <section
            key={w.id}
            className="print-block mb-8 rounded-xl border border-line p-4"
          >
            <h2 className="eyebrow mb-3 text-ink-soft">
              {w.title || w.chart?.natural_language || t('dashboardGrid.chart')}
            </h2>
            {w.chart && w.chart.data.length ? (
              <ChartRenderer
                data={w.chart.data}
                config={w.chart.chart_config}
                height={kind === 'kpi_card' ? KPI_H : CHART_H}
                showLegend={kind === 'pie'}
              />
            ) : (
              <p className="text-sm text-ink-faint">{t('dashboardGrid.noResults')}</p>
            )}
          </section>
        )
      })}
    </div>,
    document.body,
  )
}
