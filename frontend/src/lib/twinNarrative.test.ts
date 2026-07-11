import { describe, expect, it } from 'vitest'
import { buildNarrative, scenarioPacing } from './twinNarrative'
import type { EvaluatedNode } from '../types'

// Revenue = Price × Volume  (10 × 100 = 1000)
const leaf = (id: string, name: string, v: number): EvaluatedNode => ({
  id, name, operator: 'add', value: v, manual_value: v, contribution_pct: null, children: [],
})
const tree = (): EvaluatedNode => ({
  id: 'r', name: 'Revenue', operator: 'mul', value: 1000, manual_value: null, contribution_pct: null,
  children: [leaf('p', 'Price', 10), leaf('v', 'Volume', 100)],
})
const leaves = [{ id: 'p', name: 'Price' }, { id: 'v', name: 'Volume' }]

describe('buildNarrative', () => {
  it('reports the KPI move and the drivers behind it', () => {
    const n = buildNarrative(tree(), { p: 10 }, leaves, 1000)
    expect(n.simulated).toBeCloseTo(1100)
    expect(n.deltaPct).toBeCloseTo(10)
    expect(n.drivers).toHaveLength(1)
    expect(n.drivers[0]).toMatchObject({ id: 'p', name: 'Price', pct: 10 })
    expect(n.drivers[0].contribution).toBeCloseTo(100)
  })

  it('ranks drivers by absolute KPI contribution, biggest first', () => {
    const n = buildNarrative(tree(), { p: 10, v: 5 }, leaves, 1000)
    // Price +10% then Volume +5% (cumulative): Price moves 1000→1100 (+100),
    // Volume moves 1100→1155 (+55). Price is the bigger mover.
    expect(n.drivers.map((d) => d.id)).toEqual(['p', 'v'])
    expect(n.drivers[0].contribution).toBeGreaterThan(n.drivers[1].contribution)
    const sum = n.drivers.reduce((a, d) => a + d.contribution, 0)
    expect(sum).toBeCloseTo(n.simulated - 1000)
  })

  it('has no drivers and a null deltaPct edge case', () => {
    expect(buildNarrative(tree(), {}, leaves, 1000).drivers).toEqual([])
    expect(buildNarrative(tree(), { p: 10 }, leaves, 0).deltaPct).toBeNull()
  })
})

describe('scenarioPacing', () => {
  it('returns null for a zero-value target', () => {
    expect(scenarioPacing(1100, { target_value: 0 })).toBeNull()
  })

  it('computes attainment, on-track and hit', () => {
    const p = scenarioPacing(1100, { target_value: 1200, pacing: { expected_value: 1050 } })!
    expect(p.attainmentPct).toBe(92) // round(1100/1200*100)
    expect(p.onTrack).toBe(true) // 1100 ≥ 1050 expected-by-now
    expect(p.hit).toBe(false) // 1100 < 1200 target
  })

  it('hit is true when the target value is reached', () => {
    const p = scenarioPacing(1300, { target_value: 1200 })!
    expect(p.hit).toBe(true)
    expect(p.onTrack).toBe(true) // no pacing → compares to full target
  })
})
