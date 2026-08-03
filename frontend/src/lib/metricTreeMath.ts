import type { EvaluatedNode, LeafProvenance } from '../types'

/**
 * EXACT port of backend metric_tree_service._combine value semantics
 * (backend/app/services/metric_tree_service.py). The twin simulator must
 * agree with the tree page to the digit — keep the edge cases identical:
 *  - any UNKNOWN input → unknown (null), checked BEFORE the operator
 *  - empty children → 0
 *  - sub = first − sum(rest)
 *  - div = first / prod(rest); single value → denom 1; zero denom → 0
 *  - leaf value = its resolved `value` (measured or manual), never manual_value
 * The API tree is already depth-capped server-side (MAX_DEPTH), so a node
 * with children is always internal here.
 *
 * The null check leads for the same reason it does on the backend: reading an
 * unknown leaf as 0 merely understates an `add` total, but zeroes a `mul` KPI
 * outright — and both would be drawn as a confident number.
 */
export function combine(operator: string, values: (number | null)[]): number | null {
  // `== null`, not `=== null`: JS has two nullish values and the cast below
  // trusts this check. An absent `value` (a hand-built node, a response shape
  // change) would slip through a strict check as undefined, produce NaN through
  // every operator, and pass isComplete() — NaN !== null — so the hero and the
  // charts would render NaN, which is the failure this guard exists to prevent.
  if (values.some((v) => v == null)) return null
  const known = values as number[]
  if (!known.length) return 0
  if (operator === 'add') return known.reduce((a, b) => a + b, 0)
  if (operator === 'sub') return known[0] - known.slice(1).reduce((a, b) => a + b, 0)
  if (operator === 'mul') return known.reduce((a, b) => a * b, 1)
  if (operator === 'div') {
    const denom = known.length > 1 ? known.slice(1).reduce((a, b) => a * b, 1) : 1
    return denom ? known[0] / denom : 0
  }
  return 0
}

/** Adjustments: leaf node id → percent change (e.g. 15 = +15%). */
export type Adjustments = Record<string, number>

function isLeaf(node: EvaluatedNode): boolean {
  return node.children.length === 0
}

export function collectLeaves(node: EvaluatedNode): EvaluatedNode[] {
  if (isLeaf(node)) return [node]
  return node.children.flatMap(collectLeaves)
}

/**
 * Can this tree answer a what-if question at all?
 *
 * Every tool below is gated on this. With one unknown leaf each recompute is
 * null, so a waterfall, a tornado or a Monte Carlo histogram drawn from it
 * would be a picture of nothing — worse than an empty state, because it looks
 * like an answer.
 */
export function isComplete(root: EvaluatedNode): boolean {
  return !root.incomplete && root.value !== null
}

/** Re-evaluate a tree with leaf values scaled by the given adjustments.
 * Only `value` is maintained; `contribution_pct` is nulled everywhere (the
 * fetched percentages no longer apply and the twin never renders them —
 * the metric-tree editor shows the backend-computed ones). */
export function recompute(node: EvaluatedNode, adjustments: Adjustments): EvaluatedNode {
  if (isLeaf(node)) {
    // The RESOLVED value, not manual_value: a measured leaf has no manual_value
    // at all, so scaling that field would move the lever from 0 and report the
    // scenario as if nothing happened.
    const base = node.value
    if (base === null) return { ...node, value: null, contribution_pct: null }
    const pct = adjustments[node.id] ?? 0
    return { ...node, value: base * (1 + pct / 100), contribution_pct: null }
  }
  const children = node.children.map((c) => recompute(c, adjustments))
  const value = combine(node.operator, children.map((c) => c.value))
  return { ...node, value, children, contribution_pct: null }
}

/** The KPI under a scenario, or null when the tree cannot answer. */
export function kpiValue(root: EvaluatedNode, adjustments: Adjustments): number | null {
  return recompute(root, adjustments).value
}

export interface ProvenanceSummary {
  measured: string[]
  manual: string[]
  unknown: string[]
  /** Every leaf measured — the only state that needs no caveat. */
  fullyMeasured: boolean
}

/** Leaf provenance roll-up. Mirrors metric_tree_service.summarize so the page
 *  and the copilot describe the same tree the same way. */
export function provenanceSummary(root: EvaluatedNode): ProvenanceSummary {
  const by: Record<LeafProvenance, string[]> = { measured: [], manual: [], unknown: [] }
  for (const leaf of collectLeaves(root)) by[leaf.provenance ?? 'unknown'].push(leaf.name)
  return {
    ...by,
    fullyMeasured: by.measured.length > 0 && !by.manual.length && !by.unknown.length,
  }
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
 *
 * Returns [] for an incomplete tree: there is no bar to draw for an unknown.
 */
export function waterfall(
  root: EvaluatedNode,
  adjustments: Adjustments,
  leafOrder: { id: string; name: string }[],
  baseline?: number,
): WaterfallStep[] {
  if (!isComplete(root)) return []
  // Defaults to the server-evaluated value. Resolved in the body rather than in
  // the parameter list so the null case is a refusal, not a `?? 0` that would
  // draw the whole chart from an invented origin.
  const base = baseline ?? root.value
  if (base === null) return []
  const steps: WaterfallStep[] = [
    { id: '__baseline', label: '', from: 0, to: base, kind: 'baseline' },
  ]
  const applied: Adjustments = {}
  let prev = base
  for (const leaf of leafOrder) {
    const pct = adjustments[leaf.id]
    if (!pct) continue
    applied[leaf.id] = pct
    const next = kpiValue(root, applied)
    if (next === null) return []
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
export function sensitivity(root: EvaluatedNode, pct = 10, baseline?: number): SensitivityRow[] {
  if (!isComplete(root)) return []
  const base = baseline ?? root.value
  if (base === null) return []
  const rows: SensitivityRow[] = []
  for (const leaf of collectLeaves(root)) {
    const up = kpiValue(root, { [leaf.id]: pct })
    const down = kpiValue(root, { [leaf.id]: -pct })
    if (up === null || down === null) return []
    rows.push({ id: leaf.id, name: leaf.name, up: up - base, down: down - base })
  }
  return rows.sort(
    (a, b) => Math.max(Math.abs(b.up), Math.abs(b.down)) - Math.max(Math.abs(a.up), Math.abs(a.down)),
  )
}
