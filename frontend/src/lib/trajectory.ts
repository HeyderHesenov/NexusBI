import type { DecisionTrajectory } from '../types'

export interface TrajectoryRow {
  label: string
  realized: number
  counterfactual?: number
  bandBase?: number
  bandSpan?: number
}

/** Merge a decision's measurement points with its counterfactual band (matched by
 *  timestamp) into recharts rows. Points with no band entry — the pre-decision
 *  history, or the whole series under the "baseline" fallback — carry only the
 *  realized value, so the projection line/band simply don't render there. */
export function trajectoryRows(trajectory: DecisionTrajectory): TrajectoryRow[] {
  const band = new Map((trajectory.counterfactual?.band ?? []).map((b) => [b.measured_at, b]))
  return trajectory.points.map((p) => {
    const b = band.get(p.measured_at)
    return {
      label: p.measured_at.slice(0, 10),
      realized: p.value,
      counterfactual: b?.yhat,
      bandBase: b?.lower,
      bandSpan: b != null ? b.upper - b.lower : undefined,
    }
  })
}
