import { describe, expect, it } from 'vitest'
import { chartTypesIn, filterHistory } from './historyFilter'
import type { QueryHistoryItem } from '../types'

const item = (over: Partial<QueryHistoryItem>): QueryHistoryItem => ({
  id: 'x',
  natural_language: 'q',
  generated_sql: 'SELECT 1',
  chart_type: 'line',
  execution_time_ms: 100,
  created_at: '2024-01-01T00:00:00Z',
  ...over,
})

const items = [
  item({ id: 'a', natural_language: 'Aylıq gəlir', chart_type: 'line', execution_time_ms: 300, created_at: '2024-03-01T00:00:00Z' }),
  item({ id: 'b', natural_language: 'Top məhsullar', chart_type: 'bar', execution_time_ms: 100, created_at: '2024-01-01T00:00:00Z' }),
  item({ id: 'c', natural_language: 'Regionlar üzrə', chart_type: 'pie', execution_time_ms: 200, created_at: '2024-02-01T00:00:00Z' }),
]

const base = { search: '', chartType: '', sortKey: 'date' as const, sortDir: 'desc' as const }

describe('chartTypesIn', () => {
  it('returns distinct chart types, sorted', () => {
    expect(chartTypesIn(items)).toEqual(['bar', 'line', 'pie'])
  })
})

describe('filterHistory', () => {
  it('search narrows case-insensitively on the query text', () => {
    // Mixed-case input matches lowercase row text (both sides are lowercased).
    expect(filterHistory(items, { ...base, search: 'Gəlir' }).map((i) => i.id)).toEqual(['a'])
  })

  it('chart-type filter keeps only matching rows', () => {
    expect(filterHistory(items, { ...base, chartType: 'bar' }).map((i) => i.id)).toEqual(['b'])
  })

  it('combines search and filter', () => {
    expect(filterHistory(items, { ...base, search: 'x', chartType: 'bar' })).toEqual([])
  })

  it('sorts by date descending by default (newest first)', () => {
    expect(filterHistory(items, base).map((i) => i.id)).toEqual(['a', 'c', 'b'])
  })

  it('sorts by duration ascending', () => {
    expect(
      filterHistory(items, { ...base, sortKey: 'duration', sortDir: 'asc' }).map((i) => i.id),
    ).toEqual(['b', 'c', 'a'])
  })

  it('does not mutate the input array', () => {
    const copy = [...items]
    filterHistory(items, { ...base, sortDir: 'asc' })
    expect(items).toEqual(copy)
  })
})
