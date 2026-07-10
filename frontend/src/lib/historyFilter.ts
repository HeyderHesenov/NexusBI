import type { QueryHistoryItem } from '../types'

export type HistorySortKey = 'date' | 'duration'
export type SortDir = 'asc' | 'desc'

export interface HistoryQuery {
  /** Free-text match against the natural-language query (case-insensitive). */
  search: string
  /** Exact chart-type filter; '' means "all". */
  chartType: string
  sortKey: HistorySortKey
  sortDir: SortDir
}

/** Distinct chart types present in the rows, sorted — feeds the filter dropdown. */
export function chartTypesIn(items: QueryHistoryItem[]): string[] {
  return Array.from(new Set(items.map((i) => i.chart_type))).sort()
}

/** Client-side search + chart-type filter + sort over history rows. Pure: no
 *  mutation of the input, deterministic order (stable tiebreak on id). */
export function filterHistory(items: QueryHistoryItem[], q: HistoryQuery): QueryHistoryItem[] {
  const term = q.search.trim().toLowerCase()
  const filtered = items.filter((i) => {
    if (q.chartType && i.chart_type !== q.chartType) return false
    if (term && !i.natural_language.toLowerCase().includes(term)) return false
    return true
  })
  const dir = q.sortDir === 'asc' ? 1 : -1
  return [...filtered].sort((a, b) => {
    const primary =
      q.sortKey === 'duration'
        ? a.execution_time_ms - b.execution_time_ms
        : Date.parse(a.created_at) - Date.parse(b.created_at)
    if (primary !== 0) return primary * dir
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0 // stable tiebreak
  })
}
