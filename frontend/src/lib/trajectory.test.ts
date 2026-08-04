import { describe, expect, it } from 'vitest'
import { trajectoryRows } from './trajectory'
import type { DecisionTrajectory } from '../types'

const pt = (id: string, measured_at: string, value: number, data_as_of: string | null = null) => ({
  id,
  measured_at,
  value,
  data_as_of,
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

  describe('data age', () => {
    const rowsFor = (measured: string, asOf: string | null) =>
      trajectoryRows({ points: [pt('a', measured, 100, asOf)], counterfactual: null })

    it('surfaces the data age when the point is plotted later than its data', () => {
      // The baseline case: capturing a decision re-runs nothing, so the number
      // can be hours older than the tick it is drawn on.
      const rows = rowsFor('2026-01-10T12:00:00Z', '2026-01-10T09:00:00Z')
      expect(rows[0].asOf).toBe('2026-01-10T09:00:00Z')
    })

    it('stays quiet when the two stamps describe the same reading', () => {
      // A live re-measure writes them from two clock reads of the same instant;
      // repeating that in the tooltip is noise, not information.
      expect(rowsFor('2026-01-10T12:00:00Z', '2026-01-10T11:59:30Z')[0].asOf).toBeUndefined()
    })

    it('stays quiet when the age is unknown rather than implying they match', () => {
      // A row written before the column existed. `null` is not "same as
      // measured_at" and must not be rendered as a confirmation of freshness.
      expect(rowsFor('2026-01-10T12:00:00Z', null)[0].asOf).toBeUndefined()
    })

    it('ignores an unparseable stamp instead of rendering NaN', () => {
      expect(rowsFor('2026-01-10T12:00:00Z', 'not-a-date')[0].asOf).toBeUndefined()
    })
  })
})
