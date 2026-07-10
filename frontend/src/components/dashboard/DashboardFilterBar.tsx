import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Filter as FilterIcon, Plus, RotateCcw, X } from 'lucide-react'
import type { Dashboard, DashboardFilterSpec } from '../../types'
import { FIELD, Select } from '../ui/form'

interface Props {
  dashboard: Dashboard
  active: DashboardFilterSpec | null
  busy: boolean
  onApply: (spec: DashboardFilterSpec) => void
}

const MAX_VALUES = 60 // cap the value chip list so a high-cardinality column stays usable
const MAX_SLICERS = 5 // matches the public endpoint's dimension cap

const EMPTY_SPEC: DashboardFilterSpec = { date_column: null, date_start: null, date_end: null, dimensions: [] }

interface Slicer {
  column: string
  values: Set<string>
}

const slicersFrom = (active: DashboardFilterSpec | null): Slicer[] => {
  const dims = active?.dimensions ?? []
  if (!dims.length) return [{ column: '', values: new Set() }]
  return dims.map((d) => ({ column: d.column, values: new Set(d.values) }))
}

/** Persistent dashboard-wide filter: dimension slicers (several at once) + a
 *  date range, Apply → the server re-runs every widget's SQL with them AND-ed in. */
export function DashboardFilterBar({ dashboard, active, busy, onApply }: Props) {
  const { t } = useTranslation()

  // Column candidates = the union of every widget's columns.
  const columns = useMemo(() => {
    const set = new Set<string>()
    for (const w of dashboard.widgets) for (const c of w.chart?.columns ?? []) set.add(c)
    return [...set].sort()
  }, [dashboard.widgets])

  const [slicers, setSlicers] = useState<Slicer[]>(() => slicersFrom(active))
  const [dateCol, setDateCol] = useState(active?.date_column ?? '')
  const [dateStart, setDateStart] = useState(active?.date_start ?? '')
  const [dateEnd, setDateEnd] = useState(active?.date_end ?? '')

  // Distinct values per column, ACCUMULATED across renders. After an Apply the
  // widget rows are the filtered subset, so recomputing from scratch would drop
  // the deselected values and trap the user (no way to broaden). The per-column
  // domain only ever grows, so once a value is seen it stays offerable.
  const domainRef = useRef<Record<string, Set<string>>>({})
  // Memoize the sorted option list per column, invalidated only when the widget
  // data changes. Without this, valuesFor() re-scanned every widget's rows for
  // every slicer on every render (each keystroke/toggle) — O(slicers×widgets×rows).
  const sortedRef = useRef<{ widgets: Dashboard['widgets']; byCol: Record<string, string[]> }>({
    widgets: dashboard.widgets,
    byCol: {},
  })
  const valuesFor = (column: string): string[] => {
    if (!column) return []
    const cache = sortedRef.current
    if (cache.widgets !== dashboard.widgets) {
      cache.widgets = dashboard.widgets
      cache.byCol = {} // widget rows changed → recompute (domainRef keeps accumulated values)
    }
    const cached = cache.byCol[column]
    if (cached) return cached
    const acc = domainRef.current[column] ?? new Set<string>()
    for (const w of dashboard.widgets) {
      for (const row of w.chart?.data ?? []) {
        const v = row[column]
        if (v !== null && v !== undefined && v !== '') acc.add(String(v))
        if (acc.size >= MAX_VALUES) break
      }
      if (acc.size >= MAX_VALUES) break
    }
    domainRef.current[column] = acc
    const sorted = [...acc].sort()
    cache.byCol[column] = sorted
    return sorted
  }

  const patchSlicer = (i: number, next: Partial<Slicer>) =>
    setSlicers((prev) => prev.map((s, j) => (j === i ? { ...s, ...next } : s)))

  const toggleValue = (i: number, v: string) =>
    setSlicers((prev) =>
      prev.map((s, j) => {
        if (j !== i) return s
        const values = new Set(s.values)
        values.has(v) ? values.delete(v) : values.add(v)
        return { ...s, values }
      }),
    )

  const removeSlicer = (i: number) =>
    setSlicers((prev) => {
      const next = prev.filter((_, j) => j !== i)
      return next.length ? next : [{ column: '', values: new Set<string>() }]
    })

  const buildSpec = (): DashboardFilterSpec => ({
    date_column: dateCol || null,
    date_start: dateStart || null,
    date_end: dateEnd || null,
    dimensions: slicers
      .filter((s) => s.column && s.values.size)
      .map((s) => ({ column: s.column, values: [...s.values] })),
  })

  const clearAll = () => {
    setSlicers([{ column: '', values: new Set() }])
    setDateCol('')
    setDateStart('')
    setDateEnd('')
    onApply(EMPTY_SPEC)
  }

  const colOptions = [{ value: '', label: t('dashboardFilter.none') }, ...columns.map((c) => ({ value: c, label: c }))]

  return (
    <div className="mb-4 rounded-2xl border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <span className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft">
          <FilterIcon size={14} className="text-accent" />
          {t('dashboardFilter.title')}
        </span>

        {/* Date range */}
        <div className="min-w-[150px]">
          <label className="eyebrow mb-1 block">{t('dashboardFilter.dateColumn')}</label>
          <Select value={dateCol} options={colOptions} onChange={(e) => setDateCol(e.target.value)} />
        </div>
        {dateCol && (
          <>
            <div>
              <label className="eyebrow mb-1 block">{t('dashboardFilter.from')}</label>
              <input
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                className={FIELD}
              />
            </div>
            <div>
              <label className="eyebrow mb-1 block">{t('dashboardFilter.to')}</label>
              <input
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                className={FIELD}
              />
            </div>
          </>
        )}

        <div className="mb-0.5 flex items-center gap-2">
          <button
            onClick={() => onApply(buildSpec())}
            disabled={busy}
            className="rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-sm font-semibold text-accent transition hover:border-accent disabled:opacity-60"
          >
            {t('dashboardFilter.apply')}
          </button>
          <button
            onClick={clearAll}
            disabled={busy}
            aria-label={t('dashboardFilter.clear')}
            className="inline-flex items-center gap-1 rounded-xl border border-line px-3 py-2 text-sm text-ink-soft transition hover:text-ink disabled:opacity-60"
          >
            <RotateCcw size={14} />
            {t('dashboardFilter.clear')}
          </button>
        </div>
      </div>

      {/* Dimension slicers — several columns can constrain at once. */}
      <div className="mt-3 space-y-2">
        {slicers.map((s, i) => {
          const options = valuesFor(s.column)
          return (
            <div key={i} className="flex flex-wrap items-start gap-2">
              <div className="min-w-[150px]">
                {i === 0 && <label className="eyebrow mb-1 block">{t('dashboardFilter.dimension')}</label>}
                <Select
                  value={s.column}
                  options={colOptions}
                  onChange={(e) => patchSlicer(i, { column: e.target.value, values: new Set() })}
                />
              </div>
              <div className={`flex min-h-[38px] flex-1 flex-wrap items-center gap-1.5 ${i === 0 ? 'sm:mt-6' : ''}`}>
                {s.column && options.length === 0 && (
                  <span className="text-xs text-ink-faint">{t('dashboardFilter.noValues')}</span>
                )}
                {s.column &&
                  options.map((v) => {
                    const on = s.values.has(v)
                    return (
                      <button
                        key={v}
                        onClick={() => toggleValue(i, v)}
                        aria-pressed={on}
                        className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                          on
                            ? 'border-accent bg-accent-soft font-medium text-accent'
                            : 'border-line text-ink-soft hover:border-accent/50'
                        }`}
                      >
                        {v}
                      </button>
                    )
                  })}
              </div>
              {(slicers.length > 1 || s.column) && (
                <button
                  onClick={() => removeSlicer(i)}
                  aria-label={t('dashboardFilter.removeSlicer')}
                  className={`rounded-lg p-1.5 text-ink-faint transition hover:bg-surface hover:text-ink ${i === 0 ? 'sm:mt-6' : ''}`}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )
        })}
        {slicers.length < MAX_SLICERS && (
          <button
            onClick={() => setSlicers((prev) => [...prev, { column: '', values: new Set() }])}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-line px-2.5 py-1 text-xs text-ink-soft transition hover:border-accent/50 hover:text-ink"
          >
            <Plus size={12} />
            {t('dashboardFilter.addSlicer')}
          </button>
        )}
      </div>
    </div>
  )
}
