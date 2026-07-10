import { describe, expect, it } from 'vitest'
import { trajectoryRows } from './trajectory'
import type { DecisionTrajectory } from '../types'

const pt = (id: string, measured_at: string, value: number) => ({
  id,
  measured_at,
  value,
  query_log_id: null,
})

describe('trajectoryRows', () => {
  it('overlays the band onto the matching post-decision points', () => {
    const traj: DecisionTrajectory = {
      points: [
        pt('a', '2026-01-07T00:00:00Z', 98),
        pt('b', '2026-01-10T00:00:00Z', 100),
        pt('c', '2026-01-11T00:00:00Z', 140),
      ],
      counterfactual: {
        method: 'trend',
        band: [{ measured_at: '2026-01-11T00:00:00Z', yhat: 101, lower: 90, upper: 112 }],
        counterfactual_value: 101,
        delta_vs_counterfactual: 39,
      },
    }
    const rows = trajectoryRows(traj)
    expect(rows).toHaveLength(3)
    // pre-decision point has no band entry → realized only
    expect(rows[0]).toMatchObject({ label: '2026-01-07', realized: 98 })
    expect(rows[0].counterfactual).toBeUndefined()
    expect(rows[0].bandSpan).toBeUndefined()
    // the matched point carries the projection + band span (upper - lower)
    expect(rows[2]).toMatchObject({
      realized: 140,
      counterfactual: 101,
      bandBase: 90,
      bandSpan: 22,
    })
  })

  it('leaves every row band-less under the baseline fallback', () => {
    const traj: DecisionTrajectory = {
      points: [pt('a', '2026-01-10T00:00:00Z', 100), pt('b', '2026-01-11T00:00:00Z', 140)],
      counterfactual: { method: 'baseline', band: null, counterfactual_value: 100, delta_vs_counterfactual: 40 },
    }
    const rows = trajectoryRows(traj)
    expect(rows.every((r) => r.counterfactual === undefined && r.bandSpan === undefined)).toBe(true)
    expect(rows.map((r) => r.realized)).toEqual([100, 140])
  })
})
