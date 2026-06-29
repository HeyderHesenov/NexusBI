import { Database, GripVertical, RefreshCw, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Responsive, WidthProvider, type Layout, type Layouts } from 'react-grid-layout'
import type { Dashboard } from '../../types'
import { useDashboardStore } from '../../store/dashboardStore'
import { ChartRenderer } from '../charts/LazyChartRenderer'
import { FilterPills, type Filter } from '../charts/FilterPills'
import { ErrorBoundary } from '../ui/ErrorBoundary'

const ResponsiveGridLayout = WidthProvider(Responsive)

interface Props {
  dashboard: Dashboard
  onRemoveWidget: (id: string) => void
  onRefreshWidget: (id: string) => Promise<void>
  onLayoutChange: (layouts: Layouts) => void
}

/** Preserve every saved breakpoint; ensure lg has an entry per widget. */
function buildLayouts(dashboard: Dashboard): Layouts {
  const saved = (dashboard.layout as Layouts | null) ?? {}
  const byId = new Map((saved.lg ?? []).map((l) => [l.i, l]))
  const lg: Layout[] = dashboard.widgets.map((w, i) => {
    const found = byId.get(w.id)
    return (
      found ?? { i: w.id, x: (i % 2) * 6, y: Math.floor(i / 2) * 9, w: 6, h: 9, minW: 3, minH: 5 }
    )
  })
  return { ...saved, lg }
}

export function DashboardGrid({ dashboard, onRemoveWidget, onRefreshWidget, onLayoutChange }: Props) {
  const layouts = useMemo(() => buildLayouts(dashboard), [dashboard.layout, dashboard.widgets])
  const pulses = useDashboardStore((s) => s.pulses)
  const [busy, setBusy] = useState<string | null>(null)
  // Cross-filter: click a chart element → filter every widget that has that field.
  const [crossFilter, setCrossFilter] = useState<Filter | null>(null)

  const refresh = async (id: string) => {
    setBusy(id)
    try {
      await onRefreshWidget(id)
    } finally {
      setBusy(null)
    }
  }

  const widgetData = (cols: string[], data: Record<string, unknown>[]) => {
    if (!crossFilter || !cols.includes(crossFilter.field)) return data
    return data.filter((row) => String(row[crossFilter.field]) === crossFilter.value)
  }

  return (
    <>
    {crossFilter && (
      <div className="mb-4">
        <FilterPills
          filters={[crossFilter]}
          onRemove={() => setCrossFilter(null)}
          onClear={() => setCrossFilter(null)}
        />
      </div>
    )}
    <ResponsiveGridLayout
      className="-mx-2"
      layouts={layouts}
      breakpoints={{ lg: 1024, md: 768, sm: 0 }}
      cols={{ lg: 12, md: 8, sm: 4 }}
      rowHeight={34}
      margin={[16, 16]}
      draggableHandle=".drag-handle"
      onLayoutChange={(_current, all) => onLayoutChange(all)}
    >
      {dashboard.widgets.map((w) => (
        <div key={w.id} className="relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          {(pulses[w.id] ?? 0) > 0 && (
            <span
              key={pulses[w.id]}
              className="animate-flash pointer-events-none absolute inset-0 z-10 rounded-2xl"
            />
          )}
          <div className="drag-handle flex cursor-move items-center justify-between border-b border-line px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <GripVertical size={14} className="shrink-0 text-ink-faint" />
              <span className="truncate text-sm font-medium text-ink">
                {w.title || w.chart?.natural_language || 'Widget'}
              </span>
              {w.chart?.datasource_name && (
                <span className="flex shrink-0 items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[10px] text-ink-soft">
                  <Database size={10} className="text-accent" />
                  {w.chart.datasource_name}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => refresh(w.id)}
                disabled={busy === w.id}
                aria-label="Yenilə"
                className="text-ink-faint transition hover:text-accent disabled:opacity-50"
              >
                <RefreshCw size={14} className={busy === w.id ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={() => onRemoveWidget(w.id)}
                aria-label="Sil"
                className="text-ink-faint transition hover:text-[#D87C6B]"
              >
                <X size={15} />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 p-3">
            {w.chart && w.chart.data.length ? (
              <ErrorBoundary variant="widget" label="Qrafik" resetKeys={[w.chart]}>
                <ChartRenderer
                  data={widgetData(w.chart.columns, w.chart.data)}
                  config={w.chart.chart_config}
                  height="100%"
                  onPointClick={(field, value) =>
                    setCrossFilter({ field, value: String(value) })
                  }
                />
              </ErrorBoundary>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-ink-faint">
                Bu sorğunun nəticəsi yoxdur.
              </div>
            )}
          </div>
        </div>
      ))}
    </ResponsiveGridLayout>
    </>
  )
}
