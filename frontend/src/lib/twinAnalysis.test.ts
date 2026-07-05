import { describe, expect, it } from 'vitest'
import { compareScenarios, goalSeek, histogram, monteCarlo } from './twinAnalysis'
import type { EvaluatedNode } from '../types'

const leaf = (id: string, value: number, name = id): EvaluatedNode => ({
  id, name, operator: 'add', value, manual_value: value, contribution_pct: null, children: [],
})
const node = (id: string, operator: string, children: EvaluatedNode[]): EvaluatedNode => ({
  id, name: id, operator, value: 0, manual_value: null, contribution_pct: null, children,
})

// revenue = price(20) × volume(15) = 300
const revenue = node('rev', 'mul', [leaf('price', 20), leaf('volume', 15)])

describe('goalSeek', () => {
  it('solves a lever to hit an exact target', () => {
    // want 330 from 300 → price must rise +10% (22 × 15 = 330)
    const r = goalSeek(revenue, 'price', 330)
    expect(r).not.toBeNull()
    expect(r!.pct).toBeCloseTo(10, 1)
    expect(r!.reached).toBeCloseTo(330, 2)
  })

  it('solves downward targets', () => {
    // want 150 → volume must halve (−50%): 20 × 7.5 = 150
    const r = goalSeek(revenue, 'volume', 150)
    expect(r).not.toBeNull()
    expect(r!.pct).toBeCloseTo(-50, 1)
  })

  it('returns null for a zero-base lever (cannot move the KPI)', () => {
    const flat = node('r', 'mul', [leaf('a', 0), leaf('b', 10)])
    expect(goalSeek(flat, 'a', 500)).toBeNull()
  })

  it('returns null when target is out of range', () => {
    expect(goalSeek(revenue, 'price', -100)).toBeNull()
  })
})

describe('compareScenarios', () => {
  it('values each scenario against baseline with deltas', () => {
    const rows = compareScenarios(
      revenue,
      [
        { id: 's1', name: 'Up', adjustments: { price: 20 } }, // 24 × 15 = 360
        { id: 's2', name: 'Down', adjustments: { volume: -10 } }, // 20 × 13.5 = 270
      ],
      300,
    )
    expect(rows[0].value).toBeCloseTo(360, 2)
    expect(rows[0].delta).toBeCloseTo(60, 2)
    expect(rows[0].deltaPct).toBeCloseTo(20, 2)
    expect(rows[1].value).toBeCloseTo(270, 2)
    expect(rows[1].deltaPct).toBeCloseTo(-10, 2)
  })

  it('nulls deltaPct on a zero baseline', () => {
    const rows = compareScenarios(revenue, [{ id: 's', name: 'x', adjustments: {} }], 0)
    expect(rows[0].deltaPct).toBeNull()
  })
})

describe('monteCarlo', () => {
  it('is deterministic for a fixed seed', () => {
    const ranges = { price: { min: -10, max: 10 }, volume: { min: -5, max: 5 } }
    const a = monteCarlo(revenue, ranges, 300, { iterations: 500, seed: 42 })
    const b = monteCarlo(revenue, ranges, 300, { iterations: 500, seed: 42 })
    expect(a.p50).toBe(b.p50)
    expect(a.samples).toEqual(b.samples)
  })

  it('produces ordered percentiles bracketing the mean region', () => {
    const ranges = { price: { min: -20, max: 20 }, volume: { min: -20, max: 20 } }
    const r = monteCarlo(revenue, ranges, 300, { iterations: 2000, seed: 7 })
    expect(r.min).toBeLessThanOrEqual(r.p10)
    expect(r.p10).toBeLessThanOrEqual(r.p50)
    expect(r.p50).toBeLessThanOrEqual(r.p90)
    expect(r.p90).toBeLessThanOrEqual(r.max)
    // symmetric ranges around a product ⇒ median near baseline
    expect(r.p50).toBeGreaterThan(200)
    expect(r.p50).toBeLessThan(400)
  })

  it('samples are sorted ascending', () => {
    const r = monteCarlo(revenue, { price: { min: -50, max: 50 } }, 300, { iterations: 100, seed: 3 })
    for (let i = 1; i < r.samples.length; i++) expect(r.samples[i]).toBeGreaterThanOrEqual(r.samples[i - 1])
  })
})

describe('histogram', () => {
  it('buckets samples and preserves the total count', () => {
    const bins = histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)
    expect(bins).toHaveLength(5)
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(10)
  })

  it('returns empty for no samples', () => {
    expect(histogram([], 10)).toEqual([])
  })
})
