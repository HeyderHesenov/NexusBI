import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, RotateCw, Search, Trash2 } from 'lucide-react'
import { getHistory } from '../api/query'
import { useQueryStore } from '../store/queryStore'
import { useFormatDate } from '../hooks/useFormatDate'
import { useFormatNumber } from '../hooks/useFormatNumber'
import { chartTypesIn, filterHistory, type HistorySortKey, type SortDir } from '../lib/historyFilter'
import { isSqlLabel, stripSqlLabel } from '../lib/sqlLabel'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonRows } from '../components/ui/Skeleton'
import { Button } from '../components/ui/Button'
import { FIELD, Select } from '../components/ui/form'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import type { QueryHistoryItem } from '../types'

const PAGE_SIZE = 50

export function HistoryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const fmtDate = useFormatDate()
  const fmtNum = useFormatNumber()
  const ask = useQueryStore((s) => s.ask)
  const runSql = useQueryStore((s) => s.runSql)
  const deleteHistoryItem = useQueryStore((s) => s.deleteHistoryItem)

  const [items, setItems] = useState<QueryHistoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [chartType, setChartType] = useState('')
  const [sortKey, setSortKey] = useState<HistorySortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getHistory(1, limit)
      .then((page) => {
        if (!alive) return
        setItems(page.items)
        setTotal(page.total)
      })
      .catch(() => undefined)
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [limit])

  const chartOptions = useMemo(
    () => [
      { value: '', label: t('historyPage.filterAllCharts') },
      ...chartTypesIn(items).map((c) => ({ value: c, label: c })),
    ],
    [items, t],
  )

  const visible = useMemo(
    () => filterHistory(items, { search, chartType, sortKey, sortDir }),
    [items, search, chartType, sortKey, sortDir],
  )

  const toggleSort = (key: HistorySortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const rerun = (h: QueryHistoryItem) => {
    navigate('/')
    if (isSqlLabel(h.natural_language)) {
      runSql(h.generated_sql, stripSqlLabel(h.natural_language)).catch(() => undefined)
    } else {
      ask(h.natural_language).catch(() => undefined)
    }
  }

  const remove = async (id: string) => {
    // Go through the store so the QueryPage sidebar + open chat thread stay in
    // sync (it deletes server-side, drops the row from store.history, and prunes
    // any matching thread turn); then drop it from this page's own list.
    await deleteHistoryItem(id)
    setItems((xs) => xs.filter((x) => x.id !== id))
    setTotal((n) => Math.max(0, n - 1))
  }

  const emptyFiltered = items.length > 0 && visible.length === 0

  return (
    <div>
      <PageHeader
        eyebrow={t('historyPage.eyebrow')}
        title={t('historyPage.title')}
        subtitle={loading ? undefined : t('historyPage.resultsCount', { count: total })}
      />

      {/* Toolbar: search + chart-type filter */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('historyPage.searchPlaceholder')}
            aria-label={t('historyPage.searchPlaceholder')}
            className={`${FIELD} pl-9`}
          />
        </div>
        <Select
          value={chartType}
          onChange={(e) => setChartType(e.target.value)}
          options={chartOptions}
          aria-label={t('historyPage.filterAllCharts')}
          className="w-44"
        />
      </div>

      {loading && items.length === 0 ? (
        <SkeletonRows rows={8} />
      ) : items.length === 0 ? (
        <EmptyState title={t('historyPage.empty')} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-5 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">
                    {t('historyPage.colQuery')}
                  </th>
                  <th className="px-5 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">
                    {t('historyPage.colChart')}
                  </th>
                  <SortHeader
                    label={t('historyPage.colDuration')}
                    active={sortKey === 'duration'}
                    dir={sortDir}
                    onClick={() => toggleSort('duration')}
                  />
                  <SortHeader
                    label={t('historyPage.colDate')}
                    active={sortKey === 'date'}
                    dir={sortDir}
                    onClick={() => toggleSort('date')}
                  />
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {emptyFiltered ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-16 text-center text-sm text-ink-soft">
                      {t('historyPage.noMatches')}
                    </td>
                  </tr>
                ) : (
                  visible.map((h) => {
                    const sql = isSqlLabel(h.natural_language)
                    return (
                      <tr key={h.id} className="group border-t border-line transition hover:bg-surface-2">
                        <td className="max-w-[420px] px-5 py-3">
                          <button
                            onClick={() => rerun(h)}
                            title={t('historyPage.rerun')}
                            className="flex w-full items-center gap-1.5 truncate text-left text-ink transition hover:text-accent"
                          >
                            {sql && (
                              <span className="shrink-0 rounded border border-line px-1 font-mono text-[9px] uppercase tracking-wider text-ink-faint">
                                sql
                              </span>
                            )}
                            <span className="truncate">{stripSqlLabel(h.natural_language)}</span>
                          </button>
                        </td>
                        <td className="px-5 py-3">
                          <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[11px] text-accent">
                            {h.chart_type}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 font-mono text-ink-soft tabular-nums">
                          {fmtNum(h.execution_time_ms)} ms
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-ink-faint">
                          {fmtDate(h.created_at)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right">
                          <button
                            onClick={() => rerun(h)}
                            aria-label={t('historyPage.rerun')}
                            className="rounded-md p-1.5 text-ink-faint transition hover:bg-surface hover:text-accent"
                          >
                            <RotateCw size={15} />
                          </button>
                          <button
                            onClick={() => setConfirmId(h.id)}
                            aria-label={t('historyPage.deleteQuery')}
                            className="rounded-md p-1.5 text-ink-faint opacity-0 transition hover:bg-surface hover:text-[#D87C6B] focus:opacity-100 group-hover:opacity-100"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {items.length < total && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" loading={loading} onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                {t('historyPage.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={async () => {
          if (confirmId) await remove(confirmId)
        }}
        title={t('historyPage.confirmDeleteTitle')}
        message={t('historyPage.confirmDeleteMessage')}
      />
    </div>
  )
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
}) {
  return (
    <th
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className="px-5 py-3"
    >
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider transition hover:text-ink ${
          active ? 'text-ink' : 'text-ink-faint'
        }`}
      >
        {label}
        {active &&
          (dir === 'asc' ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />)}
      </button>
    </th>
  )
}
