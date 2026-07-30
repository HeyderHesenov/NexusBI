// Pure view helpers for the knowledge-graph canvas: manual node positions
// (pins) and mini-map coordinate math. Kept framework-free so the geometry is
// unit-testable without a DOM render.
import { LAYOUT_H, LAYOUT_W, type LayoutPoint } from './useForceLayout'

const PIN_KEY = 'nexusbi.graph.pins.v1'
const FULL_HIDDEN_KEY = 'nexusbi.graph.fullHidden.v1'

/** Nodes/edges the user removed from the FULL graph (which has no saved record).
 *  Persisted locally, non-destructive, reversible via "show all". Named views
 *  persist the same idea in the backend instead. */
export interface FullGraphHidden {
  nodes: string[]
  edges: string[]
}

/** Read the full-graph hidden set. Storage errors degrade to "nothing hidden". */
export function loadFullGraphHidden(): FullGraphHidden {
  try {
    const raw = localStorage.getItem(FULL_HIDDEN_KEY)
    if (!raw) return { nodes: [], edges: [] }
    const obj = JSON.parse(raw) as Partial<FullGraphHidden>
    return { nodes: obj.nodes ?? [], edges: obj.edges ?? [] }
  } catch {
    return { nodes: [], edges: [] }
  }
}

/** Persist the full-graph hidden set; a disabled/full storage just won't survive reload. */
export function saveFullGraphHidden(v: FullGraphHidden): void {
  try {
    localStorage.setItem(FULL_HIDDEN_KEY, JSON.stringify(v))
  } catch {
    /* no-op */
  }
}

/**
 * Layer manual pin positions on top of the computed layout — pins win, every
 * other node keeps its force-layout spot. Returns the layout untouched when
 * nothing is pinned so callers can rely on referential stability.
 */
export function mergePositions(
  layout: Map<string, LayoutPoint>,
  pins: Map<string, LayoutPoint>,
): Map<string, LayoutPoint> {
  if (pins.size === 0) return layout
  const merged = new Map(layout)
  for (const [id, p] of pins) merged.set(id, p)
  return merged
}

/** Read persisted pins (keyed by stable node id). Storage errors degrade to none. */
export function loadPins(): Map<string, LayoutPoint> {
  try {
    const raw = localStorage.getItem(PIN_KEY)
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Record<string, LayoutPoint>
    return new Map(Object.entries(obj))
  } catch {
    return new Map()
  }
}

/** Persist pins; a disabled/full storage just means they won't survive reload. */
export function savePins(pins: Map<string, LayoutPoint>): void {
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(Object.fromEntries(pins)))
  } catch {
    /* no-op */
  }
}

/**
 * Map a pointer position inside a mini-map of pixel size (miniW × miniH) to a
 * world coordinate. The mini-map draws the whole LAYOUT_W×LAYOUT_H canvas, so
 * this is a straight proportional scale.
 */
export function miniToWorld(
  mx: number,
  my: number,
  miniW: number,
  miniH: number,
): LayoutPoint {
  return { x: (mx / miniW) * LAYOUT_W, y: (my / miniH) * LAYOUT_H }
}

// Canonical blob-download lives in lib/download and the SVG export helpers in
// lib/chartExport (shared with the recharts surfaces); both are re-exported here
// so existing graph importers keep their `./graphView` import path.
export { downloadBlob } from '../../lib/download'
export { serializeSvg } from '../../lib/chartExport'
