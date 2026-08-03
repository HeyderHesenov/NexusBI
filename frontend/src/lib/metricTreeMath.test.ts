import { describe, expect, it } from 'vitest'
import {
  collectLeaves,
  combine,
  isComplete,
  provenanceSummary,
  recompute,
  sensitivity,
  waterfall,
} from './metricTreeMath'
import { leaf, measuredLeaf, node, unknownLeaf } from '../test/metricTreeFixtures'
import type { EvaluatedNode } from '../types'

describe('combine — backend _combine parity table', () => {
  // Mirrors backend/tests/test_metric_tree.py::test_combine_operators exactly.
  it('matches every backend edge case', () => {
    expect(combine('add', [1, 2, 3])).toBe(6)
    expect(combine('sub', [10, 3, 2])).toBe(5)
    expect(combine('mul', [2, 3, 4])).toBe(24)
    expect(combine('div', [100, 4, 5])).toBe(5) // 100 / (4*5)
    expect(combine('div', [10, 0])).toBe(0) // divide-by-zero → 0, no crash
    expect(combine('add', [])).toBe(0)
    expect(combine('div', [7])).toBe(7) // single value → denom 1 (backend: prod of empty)
    expect(combine('sub', [5])).toBe(5)
  })

  // Mirrors test_metric_tree_provenance.py::test_combine_propagates_unknown.
  it('propagates unknown under every operator', () => {
    expect(combine('mul', [2, null])).toBeNull()
    expect(combine('add', [1, null, 3])).toBeNull()
    expect(combine('sub', [10, null])).toBeNull()
    expect(combine('div', [null, 2])).toBeNull()
  })
})

describe('recompute', () => {
  const revenue = node('rev', 'mul', [leaf('price', 20), leaf('volume', 15)], 300)

  it('reproduces the backend evaluation with no adjustments', () => {
    expect(recompute(revenue, {}).value).toBe(300) // 20 × 15, backend test fixture
  })

  it('scales a leaf by the adjustment percent and re-rolls the tree', () => {
    const out = recompute(revenue, { price: 10 }) // +10% → 22 × 15
    expect(out.value).toBeCloseTo(330)
    expect(out.children[0].value).toBeCloseTo(22)
  })

  it('nulls contribution_pct everywhere — the fetched percentages no longer apply', () => {
    const sum = node('cəm', 'add', [{ ...leaf('a', 75), contribution_pct: 75 }, leaf('b', 25)])
    const out = recompute(sum, { a: 20 })
    expect(out.contribution_pct).toBeNull()
    expect(out.children[0].contribution_pct).toBeNull()
  })

  it('handles a deep chain without stack issues', () => {
    let tree: EvaluatedNode = leaf('l0', 2)
    for (let i = 1; i <= 12; i++) tree = node(`n${i}`, 'add', [tree])
    expect(recompute(tree, { l0: 50 }).value).toBe(3)
  })

  it('scales a MEASURED leaf from its measured value, not from manual_value', () => {
    // A measured leaf has manual_value: null. Reading that field would move the
    // lever from 0 and report the scenario as if it did nothing.
    const tree = node('root', 'add', [measuredLeaf('sales', 200)], 200)
    expect(recompute(tree, { sales: 10 }).value).toBeCloseTo(220)
  })

  it('leaves an unknown leaf unknown instead of scaling 0', () => {
    const tree = node('root', 'mul', [leaf('price', 20), unknownLeaf('volume')], null)
    const out = recompute(tree, { price: 50 })
    // The old port read `manual_value ?? 0` and returned 0 here — a number the
    // hero, the waterfall and the narrative would all have presented as the KPI.
    expect(out.value).toBeNull()
    expect(out.children[1].value).toBeNull()
  })

  it('ignores adjustments for unknown node ids', () => {
    expect(recompute(revenue, { ghost: 40 }).value).toBe(300)
  })
})

describe('isComplete / provenanceSummary', () => {
  it('refuses a tree with an unknown leaf and names the leaves either way', () => {
    const mixed = node('root', 'add', [measuredLeaf('a', 5), leaf('b', 2), unknownLeaf('c')], null)
    expect(isComplete(mixed)).toBe(false)
    expect(provenanceSummary(mixed)).toEqual({
      measured: ['a'], manual: ['b'], unknown: ['c'], fullyMeasured: false,
    })
  })

  it('is fullyMeasured only when every leaf is measured', () => {
    const all = node('root', 'add', [measuredLeaf('a', 5), measuredLeaf('b', 2)], 7)
    expect(isComplete(all)).toBe(true)
    expect(provenanceSummary(all).fullyMeasured).toBe(true)
    // One hand-typed assumption is enough to disqualify it.
    const one = node('root', 'add', [measuredLeaf('a', 5), leaf('b', 2)], 7)
    expect(provenanceSummary(one).fullyMeasured).toBe(false)
  })
})

describe('what-if tools refuse an incomplete tree', () => {
  const broken = node('root', 'mul', [leaf('price', 20), unknownLeaf('volume')], null)

  it('draws no waterfall and ranks no sensitivity', () => {
    expect(waterfall(broken, { price: 10 }, collectLeaves(broken))).toEqual([])
    expect(sensitivity(broken, 10)).toEqual([])
  })
})

describe('waterfall', () => {
  const revenue = node('rev', 'mul', [leaf('price', 20, 'Qiymət'), leaf('volume', 15, 'Həcm')], 300)

  it('bars sum exactly to the final value on a multiplicative tree', () => {
    const adj = { price: 10, volume: -20 }
    const steps = waterfall(revenue, adj, collectLeaves(revenue))
    const baseline = steps[0].to
    const final = steps[steps.length - 1].to
    const deltas = steps.filter((s) => s.kind === 'delta')
    const sum = baseline + deltas.reduce((acc, s) => acc + (s.to - s.from), 0)
    expect(sum).toBeCloseTo(final) // cumulative-sequential guarantee
    expect(final).toBeCloseTo(20 * 1.1 * 15 * 0.8)
  })

  it('skips untouched leaves', () => {
    const steps = waterfall(revenue, { price: 10 }, collectLeaves(revenue))
    expect(steps.filter((s) => s.kind === 'delta')).toHaveLength(1)
    expect(steps[1].label).toBe('Qiymət')
  })
})

describe('sensitivity', () => {
  it('ranks leaves by absolute impact, ± effects around the server baseline', () => {
    // Server always sends the evaluated value (1010) — deltas are measured against it.
    const tree = node('root', 'add', [leaf('big', 1000), leaf('small', 10)], 1010)
    const rows = sensitivity(tree, 10)
    expect(rows[0].id).toBe('big')
    expect(rows[0].up).toBeCloseTo(100)
    expect(rows[0].down).toBeCloseTo(-100)
    expect(rows[1].up).toBeCloseTo(1)
  })
})
