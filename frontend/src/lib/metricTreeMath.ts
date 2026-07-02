import type { EvaluatedNode } from '../types'

/**
 * EXACT port of backend metric_tree_service._combine value semantics
 * (backend/app/services/metric_tree_service.py). The twin simulator must
 * agree with the tree page to the digit — keep the edge cases identical:
 *  - empty children → 0
 *  - sub = first − sum(rest)
 *  - div = first / prod(rest); single value → denom 1; zero denom → 0
 *  - leaf value = manual_value ?? 0
 * The API tree is already depth-capped server-side (MAX_DEPTH), so a node
 * with children is always internal here.
 */
export function combine(operator: string, values: number[]): number {
  if (!values.length) return 0
  if (operator === 'add') return values.reduce((a, b) => a + b, 0)
  if (operator === 'sub') return values[0] - values.slice(1).reduce((a, b) => a + b, 0)
  if (operator === 'mul') return values.reduce((a, b) => a * b, 1)
  if (operator === 'div') {
    const denom = values.length > 1 ? values.slice(1).reduce((a, b) => a * b, 1) : 1
    return denom ? values[0] / denom : 0
  }
  return 0
}

/** Adjustments: leaf node id → percent change (e.g. 15 = +15%). */
export type Adjustments = Record<string, number>

export function isLeaf(node: EvaluatedNode): boolean {
  return node.children.length === 0
}

export function collectLeaves(node: EvaluatedNode): EvaluatedNode[] {
  if (isLeaf(node)) return [node]
  return node.children.flatMap(collectLeaves)
}

/** Re-evaluate a tree with leaf values scaled by the given adjustments.
 * Only `value` is maintained; `contribution_pct` is nulled everywhere (the
 * fetched percentages no longer apply and the twin never renders them —
 * MetricTreePage shows the backend-computed ones). */
export function recompute(node: EvaluatedNode, adjustments: Adjustments): EvaluatedNode {
  if (isLeaf(node)) {
    const base = node.manual_value ?? 0
    const pct = adjustments[node.id] ?? 0
    return { ...node, value: base * (1 + pct / 100), contribution_pct: null }
  }
  const children = node.children.map((c) => recompute(c, adjustments))
  const value = combine(node.operator, children.map((c) => c.value))
  return { ...node, value, children, contribution_pct: null }
}

export interface WaterfallStep {
  id: string
  label: string
  from: number
  to: number
  kind: 'baseline' | 'delta' | 'final'
}

/**
 * Cumulative sequential waterfall: adjustments are applied ONE BY ONE in the
 * given leaf order, so the bars sum exactly to the final KPI even on ×/÷
 * trees. Note this makes individual bar sizes order-dependent (documented
 * trade-off — the alternative, one-at-a-time deltas, doesn't sum at all on
 * non-additive trees).
 */
export function waterfall(
  root: EvaluatedNode,
  adjustments: Adjustments,
  leafOrder: { id: string; name: string }[],
  baseline: number = root.value,
): WaterfallStep[] {
  const steps: WaterfallStep[] = [
    { id: '__baseline', label: '', from: 0, to: baseline, kind: 'baseline' },
  ]
  const applied: Adjustments = {}
  let prev = baseline
  for (const leaf of leafOrder) {
    const pct = adjustments[leaf.id]
    if (!pct) continue
    applied[leaf.id] = pct
    const next = recompute(root, applied).value
    steps.push({ id: leaf.id, label: leaf.name, from: prev, to: next, kind: 'delta' })
    prev = next
  }
  steps.push({ id: '__final', label: '', from: 0, to: prev, kind: 'final' })
  return steps
}

export interface SensitivityRow {
  id: string
  name: string
  up: number // root delta at +pct
  down: number // root delta at −pct
}

/** Per-leaf ±pct impact on the root value, sorted by |impact| descending.
 * Deltas are measured against the server-evaluated `root.value` — the same
 * baseline every other display uses (single source of truth). */
export function sensitivity(root: EvaluatedNode, pct = 10, baseline: number = root.value): SensitivityRow[] {
  const rows = collectLeaves(root).map((leaf) => ({
    id: leaf.id,
    name: leaf.name,
    up: recompute(root, { [leaf.id]: pct }).value - baseline,
    down: recompute(root, { [leaf.id]: -pct }).value - baseline,
  }))
  return rows.sort(
    (a, b) => Math.max(Math.abs(b.up), Math.abs(b.down)) - Math.max(Math.abs(a.up), Math.abs(a.down)),
  )
}
