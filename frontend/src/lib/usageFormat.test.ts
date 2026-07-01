import { describe, expect, it } from 'vitest'
import { formatUsage } from './usageFormat'
import type { Usage } from '../types'

const usage = (over: Partial<Usage>): Usage => ({
  tier: 'pro',
  tier_name: 'Pro',
  used: 0,
  limit: 300,
  remaining: 300,
  period_start: null,
  resets_at: null,
  ...over,
})

describe('formatUsage', () => {
  it('returns null for no usage', () => {
    expect(formatUsage(null)).toBeNull()
  })

  it('marks limit < 0 as unlimited (∞, no bar)', () => {
    const d = formatUsage(usage({ tier: 'unlimited', tier_name: 'Limitsiz', limit: -1, remaining: -1 }))
    expect(d).toMatchObject({ unlimited: true, tierName: 'Limitsiz', pct: 0, low: false })
  })

  it('computes pct for a metered plan', () => {
    const d = formatUsage(usage({ used: 150, limit: 300, remaining: 150 }))
    expect(d).toMatchObject({ unlimited: false, pct: 50, low: false })
  })

  it('flags low when remaining is within 10% of the limit', () => {
    const d = formatUsage(usage({ used: 295, limit: 300, remaining: 5 }))
    expect(d?.low).toBe(true)
  })

  it('does not flag low at zero usage even for a tiny limit', () => {
    const d = formatUsage(usage({ used: 0, limit: 1, remaining: 1 }))
    expect(d?.low).toBe(false)
  })

  it('caps pct at 100 when over limit', () => {
    const d = formatUsage(usage({ used: 400, limit: 300, remaining: 0 }))
    expect(d?.pct).toBe(100)
  })

  it('does not divide by zero at limit 0', () => {
    const d = formatUsage(usage({ used: 0, limit: 0, remaining: 0 }))
    expect(d?.pct).toBe(0)
  })
})
