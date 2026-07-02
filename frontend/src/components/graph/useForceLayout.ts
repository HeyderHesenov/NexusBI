import { useMemo } from 'react'

export interface LayoutPoint {
  x: number
  y: number
}

interface EdgeLike {
  source: string
  target: string
}

export const LAYOUT_W = 1000
export const LAYOUT_H = 640

const REPULSION = 22000
const SPRING_K = 0.02
const SPRING_LEN = 110
const GRAVITY = 0.015
const MAX_STEP = 24 // clamp per-iteration movement so forces can't explode
const EPS = 0.01 // minimum distance — coincident points must not yield NaN

/**
 * Deterministic force-directed layout: seeded circular init + fixed iteration
 * count (no RNG, no async ticker) so the same graph always lays out the same
 * way and the math is unit-testable.
 */
export function computeLayout(
  nodeIds: string[],
  edges: EdgeLike[],
): Map<string, LayoutPoint> {
  const n = nodeIds.length
  const pos = new Map<string, LayoutPoint>()
  if (n === 0) return pos

  const cx = LAYOUT_W / 2
  const cy = LAYOUT_H / 2
  const radius = Math.min(cx, cy) * 0.8
  nodeIds.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / n
    // Slight radius stagger breaks the perfect circle so springs have work to do.
    const r = radius * (0.55 + 0.45 * ((i % 5) / 4))
    pos.set(id, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) })
  })

  const index = new Set(nodeIds)
  const links = edges.filter((e) => index.has(e.source) && index.has(e.target))

  // Repulsion is O(n²) per iteration and runs synchronously on the main
  // thread — scale the iteration count down for big graphs so a workspace
  // with hundreds of assets doesn't freeze the page on mount.
  const ITERATIONS = n <= 120 ? 180 : n <= 300 ? 80 : 30

  for (let it = 0; it < ITERATIONS; it++) {
    const cool = 1 - it / ITERATIONS
    const disp = new Map<string, LayoutPoint>(nodeIds.map((id) => [id, { x: 0, y: 0 }]))

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos.get(nodeIds[i])!
        const b = pos.get(nodeIds[j])!
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < EPS) {
          // Deterministic nudge for coincident points (index-based, no RNG).
          dx = 0.1 * (i - j)
          dy = 0.1
          d2 = dx * dx + dy * dy
        }
        const f = REPULSION / d2
        const d = Math.sqrt(d2)
        const fx = (dx / d) * Math.min(f, MAX_STEP)
        const fy = (dy / d) * Math.min(f, MAX_STEP)
        const da = disp.get(nodeIds[i])!
        const db = disp.get(nodeIds[j])!
        da.x += fx; da.y += fy
        db.x -= fx; db.y -= fy
      }
    }

    for (const e of links) {
      const a = pos.get(e.source)!
      const b = pos.get(e.target)!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), EPS)
      const f = SPRING_K * (d - SPRING_LEN)
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      const da = disp.get(e.source)!
      const db = disp.get(e.target)!
      da.x += fx; da.y += fy
      db.x -= fx; db.y -= fy
    }

    for (const id of nodeIds) {
      const p = pos.get(id)!
      const d = disp.get(id)!
      d.x += (cx - p.x) * GRAVITY
      d.y += (cy - p.y) * GRAVITY
      const step = Math.sqrt(d.x * d.x + d.y * d.y)
      const clamp = step > MAX_STEP ? (MAX_STEP / step) * cool : cool
      p.x = Math.min(Math.max(p.x + d.x * clamp, 24), LAYOUT_W - 24)
      p.y = Math.min(Math.max(p.y + d.y * clamp, 24), LAYOUT_H - 24)
    }
  }

  return pos
}

export function useForceLayout(nodeIds: string[], edges: EdgeLike[]) {
  return useMemo(() => computeLayout(nodeIds, edges), [nodeIds, edges])
}
