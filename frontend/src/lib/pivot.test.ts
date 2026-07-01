import { describe, expect, it } from 'vitest'
import { computePivot, formatPivotValue } from './pivot'

const rows = [
  { region: 'North', product: 'A', revenue: 100 },
  { region: 'North', product: 'B', revenue: 50 },
  { region: 'South', product: 'A', revenue: 30 },
  { region: 'South', product: 'A', revenue: 20 },
]

describe('computePivot — no column dimension', () => {
  it('sums the measure per row key with a grand total', () => {
    const p = computePivot(rows, { rowField: 'region', colField: null, measure: 'revenue', agg: 'sum' })
    expect(p.hasCol).toBe(false)
    expect(p.rowKeys).toEqual(['North', 'South'])
    expect(p.rowTotals).toEqual({ North: 150, South: 50 })
    expect(p.grandTotal).toBe(200)
  })

  it('count ignores the measure and counts rows', () => {
    const p = computePivot(rows, { rowField: 'region', colField: null, measure: 'revenue', agg: 'count' })
    expect(p.rowTotals).toEqual({ North: 2, South: 2 })
    expect(p.grandTotal).toBe(4)
  })

  it('avg averages underlying values (not average of cells)', () => {
    const p = computePivot(rows, { rowField: 'region', colField: null, measure: 'revenue', agg: 'avg' })
    expect(p.rowTotals.North).toBe(75) // (100+50)/2
    expect(p.rowTotals.South).toBe(25) // (30+20)/2
    expect(p.grandTotal).toBe(50) // (100+50+30+20)/4, NOT (75+25)/2
  })
})

describe('computePivot — with column dimension', () => {
  it('builds a cross-tab with row + column + grand totals', () => {
    const p = computePivot(rows, { rowField: 'region', colField: 'product', measure: 'revenue', agg: 'sum' })
    expect(p.hasCol).toBe(true)
    expect(p.colKeys).toEqual(['A', 'B'])
    expect(p.cells.North.A).toBe(100)
    expect(p.cells.North.B).toBe(50)
    expect(p.cells.South.A).toBe(50) // 30+20
    expect(p.cells.South.B).toBeNull() // no South/B row
    expect(p.colTotals).toEqual({ A: 150, B: 50 })
    expect(p.rowTotals).toEqual({ North: 150, South: 50 })
    expect(p.grandTotal).toBe(200)
  })
})

describe('computePivot — edge cases', () => {
  it('sorts numeric-looking keys numerically', () => {
    const data = [
      { id: '10', v: 1 },
      { id: '2', v: 1 },
      { id: '1', v: 1 },
    ]
    const p = computePivot(data, { rowField: 'id', colField: null, measure: 'v', agg: 'sum' })
    expect(p.rowKeys).toEqual(['1', '2', '10'])
  })

  it('returns null for a min/max over no numeric values', () => {
    const data = [{ cat: 'x', label: 'text' }]
    const p = computePivot(data, { rowField: 'cat', colField: null, measure: 'label', agg: 'max' })
    expect(p.rowTotals.x).toBeNull()
  })
})

describe('formatPivotValue', () => {
  it('renders — for null and trims decimals', () => {
    expect(formatPivotValue(null)).toBe('—')
    expect(formatPivotValue(1000)).toBe((1000).toLocaleString())
    expect(formatPivotValue(1.23456)).toBe((1.23).toLocaleString(undefined, { maximumFractionDigits: 2 }))
  })
})
