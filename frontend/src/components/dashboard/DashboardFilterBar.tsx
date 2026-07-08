import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Filter as FilterIcon, RotateCcw } from 'lucide-react'
import type { Dashboard, DashboardFilterSpec } from '../../types'
import { FIELD, Select } from '../ui/form'

interface Props {
  dashboard: Dashboard
  active: DashboardFilterSpec | null
  busy: boolean
  onApply: (spec: DashboardFilterSpec) => void
}

const MAX_VALUES = 60 // cap the value chip list so a high-cardinality column stays usable

const EMPTY_SPEC: DashboardFilterSpec = { date_column: null, date_start: null, date_end: null, dimensions: [] }

/** Persistent dashboard-wide filter: pick a dimension column + values and/or a
 *  date range, Apply → the server re-runs every widget's SQL with it AND-ed in. */
export function DashboardFilterBar({ dashboard, active, busy, onApply }: Props) {
  const { t } = useTranslation()

  // Column candidates = the union of every widget's columns.
  const columns = useMemo(() => {
    const set = new Set<string>()
    for (const w of dashboard.widgets) for (const c of w.chart?.columns ?? []) set.add(c)
    return [...set].sort()
  }, [dashboard.widgets])

  const activeDim = active?.dimensions?.[0]
  const [dimCol, setDimCol] = useState(activeDim?.column ?? '')
  const [dimValues, setDimValues] = useState<Set<string>>(new Set(activeDim?.values ?? []))
  const [dateCol, setDateCol] = useState(active?.date_column ?? '')
  const [dateStart, setDateStart] = useState(active?.date_start ?? '')
  const [dateEnd, setDateEnd] = useState(active?.date_end ?? '')

  // Distinct values for the chosen dimension, ACCUMULATED across renders. After
  // an Apply the widget rows are the filtered subset, so recomputing from scratch
  // would drop the deselected values and trap the user (no way to broaden). The
  // per-column domain only ever grows, so once a value is seen it stays offerable.
  const domainRef = useRef<Record<string, Set<string>>>({})
  const valueOptions = useMemo(() => {
    if (!dimCol) return []
    const acc = domainRef.current[dimCol] ?? new Set<string>()
    for (const w of dashboard.widgets) {
      for (const row of w.chart?.data ?? []) {
        const v = row[dimCol]
        if (v !== null && v !== undefined && v !== '') acc.add(String(v))
        if (acc.size >= MAX_VALUES) break
      }
      if (acc.size >= MAX_VALUES) break
    }
    domainRef.current[dimCol] = acc
    return [...acc].sort()
  }, [dimCol, dashboard.widgets])

  const toggleValue = (v: string) =>
    setDimValues((prev) => {
      const next = new Set(prev)
      next.has(v) ? next.delete(v) : next.add(v)
      return next
    })

  const buildSpec = (): DashboardFilterSpec => ({
    date_column: dateCol || null,
    date_start: dateStart || null,
    date_end: dateEnd || null,
    dimensions: dimCol && dimValues.size ? [{ column: dimCol, values: [...dimValues] }] : [],
  })

  const clearAll = () => {
    setDimCol('')
    setDimValues(new Set())
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

        {/* Dimension slicer */}
        <div className="min-w-[150px]">
          <label className="eyebrow mb-1 block">{t('dashboardFilter.dimension')}</label>
          <Select
            value={dimCol}
            options={colOptions}
            onChange={(e) => {
              setDimCol(e.target.value)
              setDimValues(new Set())
            }}
          />
        </div>

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

      {/* Value chips for the chosen dimension */}
      {dimCol && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {valueOptions.length === 0 && (
            <span className="text-xs text-ink-faint">{t('dashboardFilter.noValues')}</span>
          )}
          {valueOptions.map((v) => {
            const on = dimValues.has(v)
            return (
              <button
                key={v}
                onClick={() => toggleValue(v)}
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
      )}
    </div>
  )
}
