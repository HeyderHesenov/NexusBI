import type { DecisionTrajectory } from '../types'
import { parseInstant } from './format'

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

/** Below this the gap is process time, not data age, and repeating the stamp is
 *  noise. A live re-measure writes the two microseconds apart.
 *
 *  It is 60s rather than a few seconds because a cache MISS stamps the fetch
 *  BEFORE chart selection and insight generation (the backend does that on
 *  purpose, so a slow model does not age a fresh result), while `measured_at` is
 *  taken after the whole call returns — so the gap on that path is however long
 *  the LLM took.
 *
 *  This does NOT separate the two cases cleanly and cannot: LLM latency and
 *  cache staleness both live in 0–CACHE_TTL_SECONDS (300s). Raising the
 *  threshold to clear the slowest model would swallow real cache staleness,
 *  which is the case worth reporting. So a >60s AI pass shows a caption that is
 *  accurate but uninteresting — the tolerable failure of the two, since the
 *  timestamp it names is still exactly when the rows were fetched. */
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
  // `parseInstant`, not `Date.parse`: both stamps happen to share a convention
  // today (same column type, same serializer), so the raw difference is right by
  // luck rather than by construction. Parsing each as the instant it is makes
  // the gap correct even if one side ever arrives with an offset and the other
  // without.
  const gap = parseInstant(measuredAt).getTime() - parseInstant(dataAsOf).getTime()
  if (!Number.isFinite(gap) || gap < STALE_AFTER_MS) return undefined
  return dataAsOf
}
