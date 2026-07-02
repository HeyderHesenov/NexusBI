import { describe, expect, it } from 'vitest'
import { computeLayout, LAYOUT_H, LAYOUT_W } from './useForceLayout'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `n${i}`)

describe('computeLayout', () => {
  it('is deterministic — same input, same positions', () => {
    const edges = [{ source: 'n0', target: 'n1' }, { source: 'n1', target: 'n2' }]
    const a = computeLayout(ids(5), edges)
    const b = computeLayout(ids(5), edges)
    for (const id of ids(5)) {
      expect(a.get(id)).toEqual(b.get(id))
    }
  })

  it('produces finite, in-bounds positions for every node', () => {
    const nodes = ids(40)
    const edges = nodes.slice(1).map((id, i) => ({ source: nodes[i], target: id }))
    const layout = computeLayout(nodes, edges)
    for (const id of nodes) {
      const p = layout.get(id)!
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(LAYOUT_W)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(LAYOUT_H)
    }
  })

  it('survives a single node and an empty graph without NaN', () => {
    expect(computeLayout([], []).size).toBe(0)
    const one = computeLayout(['solo'], [])
    expect(Number.isFinite(one.get('solo')!.x)).toBe(true)
  })

  it('separates coincident-prone dense clusters (no two nodes at one point)', () => {
    const nodes = ids(12)
    // Star topology pulls everything toward the hub — the worst case for overlap.
    const edges = nodes.slice(1).map((id) => ({ source: 'n0', target: id }))
    const layout = computeLayout(nodes, edges)
    const seen = new Set<string>()
    for (const id of nodes) {
      const p = layout.get(id)!
      const key = `${Math.round(p.x)},${Math.round(p.y)}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it('ignores edges referencing unknown nodes', () => {
    const layout = computeLayout(['a'], [{ source: 'a', target: 'ghost' }])
    expect(Number.isFinite(layout.get('a')!.x)).toBe(true)
    expect(layout.has('ghost')).toBe(false)
  })

  it('places connected nodes closer than the layout diagonal', () => {
    const layout = computeLayout(ids(3), [{ source: 'n0', target: 'n1' }])
    const a = layout.get('n0')!
    const b = layout.get('n1')!
    const d = Math.hypot(a.x - b.x, a.y - b.y)
    expect(d).toBeLessThan(Math.hypot(LAYOUT_W, LAYOUT_H) / 2)
  })
})
