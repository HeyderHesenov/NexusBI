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
})
