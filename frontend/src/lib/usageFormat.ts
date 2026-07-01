import type { Usage } from '../types'

export interface UsageDisplay {
  tierName: string
  unlimited: boolean
  used: number
  limit: number
  pct: number // 0-100, filled bar width (0 when unlimited)
  low: boolean // near the limit → warn
}

/** Derive the plan/usage display bits from a raw usage snapshot. `limit < 0`
 * (the API's unlimited sentinel) renders as ∞ with no bar. */
export function formatUsage(usage: Usage | null): UsageDisplay | null {
  if (!usage) return null
  if (usage.limit < 0) {
    return { tierName: usage.tier_name, unlimited: true, used: usage.used, limit: usage.limit, pct: 0, low: false }
  }
  const pct = usage.limit > 0 ? Math.min(100, (usage.used / usage.limit) * 100) : 0
  // Warn only once some quota has actually been consumed, so a fresh plan with a
  // tiny limit isn't flagged "low" at zero usage.
  const low = usage.used > 0 && usage.remaining <= Math.max(1, usage.limit * 0.1)
  return { tierName: usage.tier_name, unlimited: false, used: usage.used, limit: usage.limit, pct, low }
}
