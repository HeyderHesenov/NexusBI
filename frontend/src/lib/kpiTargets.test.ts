import { describe, expect, it } from 'vitest'
import type { KPITarget } from '../api/scenario'
import { matchTarget, targetValueFor } from './kpiTargets'

const target = (name: string): KPITarget => ({
  id: name,
  name,
  target_value: 100,
  current_value: 50,
  period: 'month',
  period_start: null,
  created_at: '2026-01-01',
  pacing: { attainment_pct: 50, elapsed_pct: 50, expected_value: 50, on_track: true, status: 'on_track' },
})

describe('matchTarget', () => {
  it('matches case-insensitively on exact name', () => {
    const t = matchTarget([target('Total_Revenue')], ['total_revenue'])
    expect(t?.name).toBe('Total_Revenue')
  })

  it('matches any candidate (column or title)', () => {
    const t = matchTarget([target('Aylıq gəlir')], ['revenue', 'Aylıq gəlir '])
    expect(t?.name).toBe('Aylıq gəlir')
  })

  it('never matches by substring — wrong line is worse than none', () => {
    expect(matchTarget([target('revenue')], ['total_revenue'])).toBeNull()
  })

  it('returns null for empty candidates or no match', () => {
    expect(matchTarget([target('a')], [null, undefined, ' '])).toBeNull()
    expect(matchTarget([], ['a'])).toBeNull()
  })
})

describe('targetValueFor', () => {
  const rows = [{ v: 50 }, { v: 80 }, { v: 65 }]

  it('returns the target when it is in scale with the data', () => {
    const t = { ...target('v'), target_value: 100 }
    expect(targetValueFor(t, rows, 'v')).toBe(100)
  })

  it('suppresses a target wildly out of scale (bad title match)', () => {
    const t = { ...target('v'), target_value: 1_200_000 }
    expect(targetValueFor(t, rows, 'v')).toBeUndefined()
  })

  it('handles missing target, empty data and missing column', () => {
    expect(targetValueFor(null, rows, 'v')).toBeUndefined()
    expect(targetValueFor(target('v'), [], 'v')).toBeUndefined()
    expect(targetValueFor(target('v'), rows, 'missing')).toBeUndefined()
    expect(targetValueFor(target('v'), rows, null)).toBeUndefined()
  })

  it('excludes the rollup/total row from the scale gate (temporal series)', () => {
    // Monthly series peaks at 80; a "Cəmi" rollup sums to 900. A 500 target is out
    // of scale with the real series (500 > 80×3) yet would slip through if the 900
    // rollup inflated maxAbs (500 < 900×3).
    const withRollup = [
      { m: '2024-01', v: 50 },
      { m: '2024-02', v: 80 },
      { m: '2024-03', v: 65 },
      { m: 'Cəmi', v: 900 },
    ]
    const t = { ...target('v'), target_value: 500 }
    expect(targetValueFor(t, withRollup, 'v', 'm')).toBeUndefined()
    // Without xKey it can't tell the rollup apart → legacy permissive behavior.
    expect(targetValueFor(t, withRollup, 'v')).toBe(500)
  })

  it('keeps an in-scale target after excluding the rollup', () => {
    const withRollup = [
      { m: '2024-01', v: 50 },
      { m: '2024-02', v: 80 },
      { m: 'Cəmi', v: 130 },
    ]
    const t = { ...target('v'), target_value: 200 } // 200 <= 80×3 = 240
    expect(targetValueFor(t, withRollup, 'v', 'm')).toBe(200)
  })

  it('parses comma-grouped values in the scale gate', () => {
    const commaRows = [{ v: '1,000' }, { v: '3,000' }]
    const t = { ...target('v'), target_value: 5000 } // 5000 <= 3000×3 = 9000
    expect(targetValueFor(t, commaRows, 'v')).toBe(5000)
  })
})
