import { describe, expect, it } from 'vitest'
import type { ChartConfig } from '../types'
import { deriveKpiSeries } from './kpi'

const cfg = (over: Partial<ChartConfig> = {}): ChartConfig => ({
  chart_type: 'kpi_card',
  x_axis: 'month',
  y_axis: 'revenue',
  color_by: null,
  ...over,
})

describe('deriveKpiSeries', () => {
  it('derives latest/previous/delta from a temporal series, sorted ascending', () => {
    // Deliberately unsorted (SQL DESC order) — latest must still be 2024-03.
    const data = [
      { month: '2024-03', revenue: 120 },
      { month: '2024-01', revenue: 100 },
      { month: '2024-02', revenue: 80 },
    ]
    const s = deriveKpiSeries(data, cfg())
    expect(s.yKey).toBe('revenue')
    expect(s.points).toEqual([100, 80, 120])
    expect(s.latest).toBe(120)
    expect(s.previous).toBe(80)
    expect(s.deltaPct).toBeCloseTo(50)
  })

  it('resolves the numeric column when y_axis is unset — and reports it', () => {
    const data = [
      { month: '2024-01', revenue: 100 },
      { month: '2024-02', revenue: 120 },
    ]
    const s = deriveKpiSeries(data, cfg({ y_axis: null }))
    expect(s.yKey).toBe('revenue') // NOT 'month' (first key)
    expect(s.latest).toBe(120)
  })

  it('reports negative deltas', () => {
    const data = [
      { month: '2024-01', revenue: 100 },
      { month: '2024-02', revenue: 75 },
    ]
    expect(deriveKpiSeries(data, cfg()).deltaPct).toBeCloseTo(-25)
  })

  it('single row → latest only, no fabricated delta', () => {
    const s = deriveKpiSeries([{ revenue: 42 }], cfg({ x_axis: null }))
    expect(s.latest).toBe(42)
    expect(s.previous).toBeNull()
    expect(s.deltaPct).toBeNull()
    expect(s.points).toEqual([])
  })

  it('non-temporal multi-row → no delta (categories are not periods)', () => {
    const data = [
      { month: 'Bakı', revenue: 10 },
      { month: 'Gəncə', revenue: 20 },
    ]
    const s = deriveKpiSeries(data, cfg())
    expect(s.deltaPct).toBeNull()
    expect(s.points).toEqual([])
  })

  it('previous of 0 yields no delta (division guard)', () => {
    const data = [
      { month: '2024-01', revenue: 0 },
      { month: '2024-02', revenue: 50 },
    ]
    expect(deriveKpiSeries(data, cfg()).deltaPct).toBeNull()
  })

  it('empty data and non-numeric values degrade to nulls', () => {
    expect(deriveKpiSeries([], cfg()).latest).toBeNull()
    const s = deriveKpiSeries([{ revenue: 'çox' }], cfg({ x_axis: null }))
    expect(s.latest).toBeNull()
  })

  it('excludes rollup/total rows — a "Cəmi" label must not become "latest"', () => {
    const data = [
      { month: '2024-01', revenue: 100 },
      { month: '2024-02', revenue: 120 },
      { month: '2024-03', revenue: 90 },
      { month: 'Cəmi', revenue: 310 },
    ]
    const s = deriveKpiSeries(data, cfg())
    expect(s.latest).toBe(90)
    expect(s.points).toEqual([100, 120, 90])
  })

  it('drops NULL cells instead of treating them as 0', () => {
    const data = [
      { month: '2024-01', revenue: 100 },
      { month: '2024-02', revenue: 120 },
      { month: '2024-03', revenue: null },
    ]
    const s = deriveKpiSeries(data, cfg())
    expect(s.latest).toBe(120) // in-progress month with no data yet is skipped
    expect(s.deltaPct).toBeCloseTo(20)
  })

  it('never picks the time axis as the value column (numeric years)', () => {
    const data = [
      { il: '2022', satis: 500 },
      { il: '2023', satis: 900 },
    ]
    const s = deriveKpiSeries(data, cfg({ x_axis: 'il', y_axis: null }))
    expect(s.yKey).toBe('satis') // NOT 'il' even though Number('2022') is finite
    // Bare years don't match the shared YYYY-MM temporal regex (same limit as
    // the backend) → no fabricated delta; the first row's value is shown.
    expect(s.latest).toBe(500)
    expect(s.deltaPct).toBeNull()
  })

  it('samples several rows for the numeric column — a NULL first cell must not misclassify', () => {
    const data = [
      { month: '2024-01', revenue: null }, // first cell is NULL...
      { month: '2024-02', revenue: 120 },
      { month: '2024-03', revenue: 90 },
    ]
    const s = deriveKpiSeries(data, cfg({ y_axis: null }))
    expect(s.yKey).toBe('revenue') // ...but the column is still detected as the measure, NOT 'month'
    expect(s.latest).toBe(90)
  })

  it('parses comma-grouped numbers ("1,234" → 1234), mirroring backend to_float', () => {
    const s = deriveKpiSeries([{ revenue: '1,234' }], cfg({ x_axis: null }))
    expect(s.latest).toBe(1234)
  })

  it('keeps a single text answer row on its first column (NL answers)', () => {
    const s = deriveKpiSeries([{ mehsul: 'Alma şirəsi', say: 342 }], cfg({ x_axis: null, y_axis: null }))
    expect(s.yKey).toBe('mehsul')
    expect(s.latest).toBeNull() // card falls back to the raw string display
  })

  it('sorts mixed -/ separators chronologically', () => {
    const data = [
      { month: '2024/03', revenue: 3 },
      { month: '2024-11', revenue: 11 },
      { month: '2024/01', revenue: 1 },
      { month: '2024-02', revenue: 2 },
    ]
    const s = deriveKpiSeries(data, cfg())
    expect(s.points).toEqual([1, 2, 3, 11])
    expect(s.latest).toBe(11)
  })
})
