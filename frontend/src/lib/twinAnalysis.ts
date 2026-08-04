import type { EvaluatedNode } from '../types'
import { isComplete, kpiValue, type Adjustments } from './metricTreeMath'

/**
 * Twin analytics built on top of the backend-parity core (metricTreeMath).
 * Three what-if tools: goal seek (solve a lever for a target KPI), scenario
 * comparison (value each saved scenario against baseline), and Monte Carlo
 * (sample lever ranges into a KPI distribution). All client-side.
 *
 * Every entry point refuses an incomplete tree (`isComplete`). A KPI built on an
 * unknown leaf has no value, so solving for it, ranking levers against it, or
 * sampling a distribution around it would all produce confident output about a
 * number that does not exist.
 */

const round1 = (n: number): number => Math.round(n * 10) / 10

/** Value of the root KPI when a single leaf is scaled by `pct` percent. */
function valueAt(root: EvaluatedNode, leafId: string, pct: number): number | null {
  return kpiValue(root, { [leafId]: pct })
}

export interface GoalSeekResult {
  /** Percent change on the chosen leaf that reaches (≈) the target. */
  pct: number
  /** Root KPI value at that percent — may differ from target on a flat leaf. */
  reached: number
}

/**
 * Solve: what percent change to `leafId` makes the root KPI equal `target`?
 * 1-D root-find over pct ∈ [minPct, maxPct]. Samples for a sign change (robust
 * to non-monotonic ÷ trees) then bisects. Returns null when unreachable in
 * range (e.g. a zero-base leaf that can't move the KPI).
 */
export function goalSeek(
  root: EvaluatedNode,
  leafId: string,
  target: number,
  opts: { minPct?: number; maxPct?: number } = {},
): GoalSeekResult | null {
  // No target is reachable on a KPI that has no value. Returning null puts this
  // in the same bucket as "unreachable in range", which the panel already
  // explains — and which is exactly what it is.
  if (!isComplete(root)) return null

  const lo = opts.minPct ?? -95
  const hi = opts.maxPct ?? 500
  const g = (pct: number): number | null => {
    const v = valueAt(root, leafId, pct)
    return v === null ? null : v - target
  }
  const EPS = Math.max(Math.abs(target) * 1e-9, 1e-9)

  // Report the KPI at the ROUNDED pct — that is the value the simulator will
  // show after Apply, so the "reached" readout must match it, not the raw root.
  const solution = (pct: number): GoalSeekResult | null => {
    const r = round1(pct)
    const reached = valueAt(root, leafId, r)
    return reached === null ? null : { pct: r, reached }
  }

  let prevX = lo
  let prevG = g(lo)
  if (prevG === null) return null
  if (Math.abs(prevG) <= EPS) return solution(lo)

  const N = 240
  for (let i = 1; i <= N; i++) {
    const x = lo + ((hi - lo) * i) / N
    const gx = g(x)
    if (gx === null) return null
    if (Math.abs(gx) <= EPS) return solution(x)
    if (prevG < 0 !== gx < 0) {
      let a = prevX
      let b = x
      for (let k = 0; k < 60; k++) {
        const mid = (a + b) / 2
        const gm = g(mid)
        if (gm === null) return null
        if (Math.abs(gm) <= EPS) {
          a = b = mid
          break
        }
        if (gm < 0 === prevG < 0) a = mid
        else b = mid
      }
      return solution((a + b) / 2)
    }
    prevX = x
    prevG = gx
  }
  return null
}

export interface CompareRow {
  id: string
  name: string
  value: number
  delta: number
  deltaPct: number | null
}

/** Value each scenario's adjustments against the shared baseline. */
export function compareScenarios(
  root: EvaluatedNode,
  scenarios: { id: string; name: string; adjustments: Adjustments }[],
  baseline: number,
): CompareRow[] {
  if (!isComplete(root)) return []
  return scenarios.flatMap((sc) => {
    const value = kpiValue(root, sc.adjustments)
    // Unreachable past the guard; dropping the row is still the right failure —
    // a comparison table is a ranking, and a fabricated number would reorder it.
    if (value === null) return []
    const delta = value - baseline
    return [{
      id: sc.id,
      name: sc.name,
      value,
      delta,
      deltaPct: baseline ? (delta / Math.abs(baseline)) * 100 : null,
    }]
  })
}

/** Per-leaf uniform sampling range, in percent (e.g. {min: -10, max: 20}). */
export type LeverRanges = Record<string, { min: number; max: number }>

/** Deterministic PRNG (mulberry32) — same seed ⇒ same distribution, so the
 * chart is stable across re-renders and unit-testable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface MonteCarloResult {
  samples: number[] // sorted ascending
  baseline: number
  mean: number
  p10: number
  p50: number
  p90: number
  min: number
  max: number
}

/** Sample each lever uniformly within its range, recompute the KPI per draw,
 * and summarise the resulting distribution. */
export function monteCarlo(
  root: EvaluatedNode,
  ranges: LeverRanges,
  baseline: number,
  opts: { iterations?: number; seed?: number } = {},
): MonteCarloResult | null {
  // A distribution around an unknown KPI is the most misleading output on this
  // page: it renders as a confident bell curve with percentiles attached.
  if (!isComplete(root)) return null
  const iterations = Math.max(1, opts.iterations ?? 1000)
  const rand = mulberry32(opts.seed ?? 1)
  const ids = Object.keys(ranges)
  const samples = new Array<number>(iterations)
  for (let i = 0; i < iterations; i++) {
    const adj: Adjustments = {}
    for (const id of ids) {
      const { min, max } = ranges[id]
      adj[id] = min + (max - min) * rand()
    }
    const v = kpiValue(root, adj)
    if (v === null) return null
    samples[i] = v
  }
  samples.sort((a, b) => a - b)
  const quantile = (p: number) =>
    samples[Math.min(samples.length - 1, Math.max(0, Math.floor(p * samples.length)))]
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length
  return {
    samples,
    baseline,
    mean,
    p10: quantile(0.1),
    p50: quantile(0.5),
    p90: quantile(0.9),
    min: samples[0],
    max: samples[samples.length - 1],
  }
}

export interface HistBin {
  x0: number
  x1: number
  count: number
}

/** Bucket sorted samples into `bins` equal-width bars for the distribution chart. */
export function histogram(samples: number[], bins = 24): HistBin[] {
  if (!samples.length) return []
  const min = samples[0]
  const max = samples[samples.length - 1]
  const span = max - min || 1
  const width = span / bins
  const out: HistBin[] = Array.from({ length: bins }, (_, i) => ({
    x0: min + i * width,
    x1: min + (i + 1) * width,
    count: 0,
  }))
  for (const v of samples) {
    const idx = Math.min(bins - 1, Math.floor((v - min) / width))
    out[idx].count++
  }
  return out
}

/** The current root's leaves that carry a range — scopes Monte Carlo to this
 * KPI (a stale range on a leaf outside `leaves` can never enter the run). */
export function activeRanges(leaves: EvaluatedNode[], ranges: LeverRanges): LeverRanges {
  const out: LeverRanges = {}
  for (const l of leaves) {
    if (ranges[l.id]) out[l.id] = ranges[l.id]
  }
  return out
}
