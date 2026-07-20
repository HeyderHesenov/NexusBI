import { describe, expect, it } from 'vitest'
import type { ChartConfig } from '../../../types'
import {
  foldOther,
  pickAxes,
  pickScatterAxes,
  pickSeries,
  sortSlices,
  topN,
  valueTotal,
} from './previewData'

const cfg = (over: Partial<ChartConfig> = {}): ChartConfig => ({
  chart_type: 'bar',
  x_axis: 'city',
  y_axis: 'revenue',
  color_by: null,
  ...over,
})

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ city: `C${i}`, revenue: (n - i) * 10 }))

describe('pickAxes', () => {
  it('uses the configured axes', () => {
    expect(pickAxes(rows(1), cfg())).toEqual({ name: 'city', value: 'revenue' })
  })

  it('falls back to the first two columns, like the widgets do', () => {
    const data = [{ a: 'x', b: 5 }]
    expect(pickAxes(data, cfg({ x_axis: null, y_axis: null }))).toEqual({ name: 'a', value: 'b' })
  })

  it('survives empty data', () => {
    expect(pickAxes([], cfg({ x_axis: null, y_axis: null }))).toEqual({ name: '', value: '' })
  })
})

describe('sortSlices', () => {
  it('ranks by value, biggest first', () => {
    const data = [
      { city: 'A', revenue: 1 },
      { city: 'B', revenue: 9 },
      { city: 'C', revenue: 5 },
    ]
    expect(sortSlices(data, cfg()).map((s) => s.label)).toEqual(['B', 'C', 'A'])
  })

  it('coerces non-numeric values to 0 rather than NaN-poisoning the sort', () => {
    const data = [
      { city: 'A', revenue: 'yox' },
      { city: 'B', revenue: 3 },
    ]
    expect(sortSlices(data, cfg())).toEqual([
      { label: 'B', value: 3 },
      { label: 'A', value: 0 },
    ])
  })
})

describe('foldOther', () => {
  const label = (count: number) => `Digər (${count})`

  it('folds the tail into one summed slice past n', () => {
    // 7 rows, n=4 → tail of 3 folds
    const out = foldOther(rows(7), cfg(), 4, label)
    expect(out).toHaveLength(5)
    const last = out[4]
    expect(last.isOther).toBe(true)
    expect(last.label).toBe('Digər (3)')
    // rows(7) values are 70,60,50,40,30,20,10 → tail = 30+20+10
    expect(last.value).toBe(60)
  })

  it('preserves the grand total so percentages stay exact', () => {
    const before = rows(9).reduce((s, r) => s + r.revenue, 0)
    const after = foldOther(rows(9), cfg(), 4, label).reduce((s, x) => s + x.value, 0)
    expect(after).toBe(before)
  })

  it('does not fold a tail of one — "Digər (1)" would be a lie', () => {
    // Mirrors PieChartWidget.tsx:38 (sorted.length <= n + 1 → no fold).
    const out = foldOther(rows(5), cfg(), 4, label)
    expect(out).toHaveLength(5)
    expect(out.some((s) => s.isOther)).toBe(false)
  })

  it('leaves short data untouched', () => {
    expect(foldOther(rows(3), cfg(), 4, label)).toHaveLength(3)
  })
})

describe('topN', () => {
  it('truncates without summing — a bar list is a ranking, not a total', () => {
    const { rows: out, rest } = topN(rows(15), cfg(), 4)
    expect(out).toHaveLength(4)
    expect(rest).toBe(11)
    expect(out.some((s) => s.isOther)).toBe(false)
  })

  it('reports no remainder when everything fits', () => {
    expect(topN(rows(3), cfg(), 4).rest).toBe(0)
  })

  it('scales against the largest visible value', () => {
    expect(topN(rows(15), cfg(), 4).max).toBe(150)
  })

  it('never returns max 0 — bars divide by it', () => {
    const data = [{ city: 'A', revenue: 0 }]
    expect(topN(data, cfg(), 4).max).toBe(1)
  })
})

describe('valueTotal', () => {
  it('sums magnitudes', () => {
    const data = [
      { city: 'A', revenue: 5 },
      { city: 'B', revenue: -3 },
    ]
    expect(valueTotal(data, cfg())).toBe(8)
  })

  it('is 0 when the value column is missing — the viability signal', () => {
    expect(valueTotal([{ city: 'A' }], cfg())).toBe(0)
  })
})

describe('pickSeries', () => {
  it('keeps row order — a trend follows the data, not a ranking', () => {
    const data = [
      { month: '2024-01', revenue: 30 },
      { month: '2024-02', revenue: 10 },
      { month: '2024-03', revenue: 20 },
    ]
    expect(pickSeries(data, cfg({ x_axis: 'month' }))).toEqual([30, 10, 20])
  })

  it('draws a series for a CATEGORICAL x axis', () => {
    // The reason this exists instead of deriveKpiSeries, which gates on
    // looksTemporal (lib/kpi.ts:92) and would return no points here.
    const data = [
      { city: 'Bakı', revenue: 12 },
      { city: 'Gəncə', revenue: 6 },
    ]
    expect(pickSeries(data, cfg({ chart_type: 'line' }))).toEqual([12, 6])
  })

  it('falls back to the first numeric column when y_axis is not numeric', () => {
    const data = [
      { city: 'A', revenue: 'n/a', count: 4 },
      { city: 'B', revenue: 'n/a', count: 7 },
    ]
    expect(pickSeries(data, cfg())).toEqual([4, 7])
  })

  it('returns nothing for empty data', () => {
    expect(pickSeries([], cfg())).toEqual([])
  })
})

describe('pickScatterAxes', () => {
  it('honors configured axes when both are numeric', () => {
    const data = [{ w: 1, h: 2 }]
    expect(pickScatterAxes(data, cfg({ x_axis: 'w', y_axis: 'h' }))).toEqual({ x: 'w', y: 'h' })
  })

  it('falls back to two distinct numeric columns when the config is not numeric', () => {
    // Mirrors ScatterChartWidget.tsx:28-35.
    const data = [{ city: 'A', w: 1, h: 2 }]
    expect(pickScatterAxes(data, cfg({ x_axis: 'city', y_axis: 'city' }))).toEqual({ x: 'w', y: 'h' })
  })
})
