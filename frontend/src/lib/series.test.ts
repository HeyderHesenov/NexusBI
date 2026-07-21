import { describe, expect, it } from 'vitest'
import { collapseByX, pivotSeries, sortByX } from './series'

const long = [
  { month: 'Yan', revenue: 10, region: 'Bakı' },
  { month: 'Yan', revenue: 5, region: 'Gəncə' },
  { month: 'Fev', revenue: 20, region: 'Bakı' },
  { month: 'Fev', revenue: 8, region: 'Gəncə' },
]

const pivot = (
  data: Record<string, unknown>[],
  x: string,
  y: string,
  c: string,
  max = 6,
  other = 'Digər',
) => pivotSeries(data, x, y, c, max, other)

describe('pivotSeries', () => {
  it('pivots long rows to one row per x with a column per series', () => {
    const { rows, series } = pivot(long, 'month', 'revenue', 'region')
    expect(series).toEqual(['Bakı', 'Gəncə'])
    expect(rows).toEqual([
      { month: 'Yan', 'Bakı': 10, 'Gəncə': 5 },
      { month: 'Fev', 'Bakı': 20, 'Gəncə': 8 },
    ])
  })

  it('keeps series in FIRST-SEEN order so colors follow entities, not rank', () => {
    const data = [
      { m: 'a', v: 1, c: 'small' },
      { m: 'a', v: 100, c: 'big' },
    ]
    // "big" outranks by total but "small" appeared first — order must not flip
    // when totals reorder between live refreshes.
    expect(pivot(data, 'm', 'v', 'c').series).toEqual(['small', 'big'])
  })

  it('folds the smallest-total series into the other bucket (hues never cycle)', () => {
    const data = Array.from({ length: 8 }, (_, i) => ({
      m: 'a',
      v: 100 - i,
      c: `s${i}`,
    }))
    const { rows, series } = pivot(data, 'm', 'v', 'c', 4)
    expect(series).toEqual(['s0', 's1', 's2', 'Digər'])
    // folded bucket sums the remaining five series: 97+96+95+94+93
    expect(rows[0]['Digər']).toBe(97 + 96 + 95 + 94 + 93)
  })

  it('sums duplicate (x, series) cells', () => {
    const data = [
      { m: 'a', v: 1, c: 'x' },
      { m: 'a', v: 2, c: 'x' },
    ]
    expect(pivot(data, 'm', 'v', 'c').rows[0]['x']).toBe(3)
  })

  it('keeps missing cells undefined (honest gaps)', () => {
    const data = [
      { m: 'a', v: 1, c: 'x' },
      { m: 'b', v: 2, c: 'y' },
    ]
    const { rows } = pivot(data, 'm', 'v', 'c')
    expect(rows[0]['y']).toBeUndefined()
    expect(rows[1]['x']).toBeUndefined()
  })

  it('guards a series named exactly like the x column', () => {
    const data = [{ m: 'a', v: 1, c: 'm' }]
    const { rows, series } = pivot(data, 'm', 'v', 'c')
    expect(series).toEqual(['m\u00A0'])
    expect(rows[0]['m']).toBe('a') // label survives
    expect(rows[0]['m\u00A0']).toBe(1)
  })

  it('guards a real category named exactly like the fold bucket', () => {
    // 5 series, max 4 → one folds. The kept category literally named "Digər"
    // must not absorb the folded tail.
    const data = [
      { m: 'a', v: 50, c: 'Digər' },
      { m: 'a', v: 40, c: 'b' },
      { m: 'a', v: 30, c: 'c' },
      { m: 'a', v: 2, c: 'd' },
      { m: 'a', v: 1, c: 'e' },
    ]
    const { rows, series } = pivot(data, 'm', 'v', 'c', 4)
    expect(series).toEqual(['Digər', 'b', 'c', 'Digər\u00A0'])
    expect(rows[0]['Digər']).toBe(50) // the real category
    expect(rows[0]['Digər\u00A0']).toBe(3) // the folded tail (2+1)
  })
})

describe('collapseByX', () => {
  it('sums y over duplicate x into one point per x (first-seen order)', () => {
    const raw = [
      { d: '2024-02-15', rev: 10 },
      { d: '2024-01-15', rev: 5 },
      { d: '2024-02-15', rev: 20 },
      { d: '2024-01-15', rev: 3 },
    ]
    expect(collapseByX(raw, 'd', 'rev')).toEqual([
      { d: '2024-02-15', rev: 30 },
      { d: '2024-01-15', rev: 8 },
    ])
  })

  it('returns the input UNCHANGED when every x is already unique', () => {
    const agg = [
      { d: '2024-01', rev: 8, note: 'keep' },
      { d: '2024-02', rev: 30, note: 'keep' },
    ]
    const out = collapseByX(agg, 'd', 'rev')
    expect(out).toBe(agg) // same reference — extra columns survive
  })

  it('treats missing/non-numeric y as 0', () => {
    const raw = [
      { d: 'a', v: null },
      { d: 'a', v: 4 },
    ]
    expect(collapseByX(raw, 'd', 'v')).toEqual([{ d: 'a', v: 4 }])
  })
})

describe('sortByX', () => {
  it('orders ISO date-ish x chronologically (lexicographic = chronological)', () => {
    const rows = [
      { d: '2024-07-15', v: 1 },
      { d: '2024-03-15', v: 2 },
      { d: '2024-11-15', v: 3 },
    ]
    expect(sortByX(rows, 'd').map((r) => r.d)).toEqual([
      '2024-03-15',
      '2024-07-15',
      '2024-11-15',
    ])
  })

  it('orders YYYY-MM months chronologically', () => {
    const rows = [{ m: '2024-10' }, { m: '2024-02' }, { m: '2024-12' }]
    expect(sortByX(rows, 'm').map((r) => r.m)).toEqual(['2024-02', '2024-10', '2024-12'])
  })

  it('sorts numeric x by value, not string', () => {
    const rows = [{ x: 10 }, { x: 2 }, { x: 1 }]
    expect(sortByX(rows, 'x').map((r) => r.x)).toEqual([1, 2, 10])
  })

  it('leaves arbitrary category x in query order (e.g. funnel stages)', () => {
    const rows = [{ s: 'Ziyarət' }, { s: 'Qeydiyyat' }, { s: 'Alış' }]
    expect(sortByX(rows, 's').map((r) => r.s)).toEqual(['Ziyarət', 'Qeydiyyat', 'Alış'])
  })

  it('does not mutate the input array', () => {
    const rows = [{ d: '2024-03' }, { d: '2024-01' }]
    sortByX(rows, 'd')
    expect(rows.map((r) => r.d)).toEqual(['2024-03', '2024-01'])
  })
})
