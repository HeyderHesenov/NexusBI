import type { EvaluatedNode } from '../types'
import { recompute, waterfall, type Adjustments } from './metricTreeMath'

export interface NarrativeDriver {
  id: string
  name: string
  /** The lever's own % change. */
  pct: number
  /** How much this lever moved the KPI (cumulative-sequential, so drivers sum
   *  to the total delta — matches the waterfall). */
  contribution: number
}

export interface Narrative {
  simulated: number
  deltaPct: number | null
  /** Adjusted levers, biggest KPI mover first. */
  drivers: NarrativeDriver[]
}

/**
 * Plain-language "what changed" data for a scenario: the KPI's % move and the
 * ranked levers behind it. Contributions reuse the waterfall decomposition so
 * they sum exactly to the total delta.
 */
export function buildNarrative(
  root: EvaluatedNode,
  adjustments: Adjustments,
  leaves: { id: string; name: string }[],
  baseline: number,
): Narrative {
  const simulated = recompute(root, adjustments).value
  const deltaPct = baseline ? ((simulated - baseline) / Math.abs(baseline)) * 100 : null
  const drivers = waterfall(root, adjustments, leaves, baseline)
    .filter((s) => s.kind === 'delta')
    .map((s) => ({ id: s.id, name: s.label, pct: adjustments[s.id] ?? 0, contribution: s.to - s.from }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
  return { simulated, deltaPct, drivers }
}

export interface ScenarioPacing {
  /** Simulated KPI as a % of the target value. */
  attainmentPct: number
  /** At/above the target's expected-by-now pace (falls back to the full target). */
  onTrack: boolean
  /** Simulated KPI reaches or beats the target value. */
  hit: boolean
}

/**
 * Does this simulated KPI hit / pace toward a saved KPI target? Client-side —
 * mirrors the KPICard pacing gate. Returns null for a zero-value target.
 */
export function scenarioPacing(
  simulated: number,
  target: { target_value: number; pacing?: { expected_value: number } },
): ScenarioPacing | null {
  if (!target.target_value) return null
  return {
    attainmentPct: Math.round((simulated / target.target_value) * 100),
    onTrack: target.pacing ? simulated >= target.pacing.expected_value : simulated >= target.target_value,
    hit: simulated >= target.target_value,
  }
}
