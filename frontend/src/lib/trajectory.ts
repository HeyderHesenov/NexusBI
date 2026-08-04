import type { DecisionTrajectory } from '../types'

export interface TrajectoryRow {
  label: string
  realized: number
  counterfactual?: number
  bandBase?: number
  bandSpan?: number
  /** Set only when the data behind this point is meaningfully older than the
   *  point itself — i.e. when naming one timestamp would be misleading. */
  asOf?: string
}

/** Below this the two stamps describe the same reading and saying so twice is
 *  noise: a live re-measure writes them microseconds apart, and the baseline
 *  path writes them from two different clock reads of the same instant. */
const STALE_AFTER_MS = 60_000

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
      asOf: staleAsOf(p.measured_at, p.data_as_of),
    }
  })
}

/** The point's data age, but only when it disagrees with the point's own stamp.
 *
 *  A baseline is lifted from the spawning query's stored result with no re-run,
 *  so it can be hours older than the moment the decision was made — the chart
 *  would otherwise plot a day-old number on today's tick with nothing saying so.
 *  `null` means unknown (a row written before the column existed) and must not be
 *  shown as if it were equal. */
function staleAsOf(measuredAt: string, dataAsOf: string | null): string | undefined {
  if (!dataAsOf) return undefined
  const gap = Date.parse(measuredAt) - Date.parse(dataAsOf)
  if (!Number.isFinite(gap) || gap < STALE_AFTER_MS) return undefined
  return dataAsOf
}
