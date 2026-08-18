import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Plan, Usage } from '../types'

const upgrade = vi.fn()
const startCheckout = vi.fn()
const openPortal = vi.fn()
const loadPlans = vi.fn()
const loadUsage = vi.fn()

let state: Record<string, unknown>

vi.mock('../store/billingStore', () => ({
  useBillingStore: Object.assign(() => state, { getState: () => state }),
}))

import { PricingPage } from './PricingPage'

const plan = (key: string, price: number): Plan => ({
  key,
  name: key.toUpperCase(),
  price_usd: price,
  monthly_quota: 1000,
  features: [],
})

const usage = (over: Partial<Usage> = {}): Usage => ({
  tier: 'free',
  tier_name: 'Free',
  used: 0,
  limit: 300,
  remaining: 300,
  period_start: null,
  resets_at: null,
  payments_enabled: false,
  has_subscription: false,
  ...over,
})

const setup = (over: Partial<Usage> = {}) => {
  upgrade.mockReset()
  startCheckout.mockReset()
  openPortal.mockReset()
  state = {
    plans: [plan('free', 0), plan('pro', 20)],
    usage: usage(over),
    loading: false,
    loadPlans: loadPlans.mockResolvedValue(undefined),
    loadUsage: loadUsage.mockResolvedValue(undefined),
    upgrade,
    startCheckout,
    openPortal,
  }
  return render(<PricingPage />)
}

// Test i18n runs in Azerbaijani (src/test/setup.ts).
const UPGRADE = 'Yüksəlt'
const MANAGE = 'Abunəni idarə et'
const SWITCH = 'Keç'

describe('PricingPage payment path', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts a real checkout when the server says payments exist', () => {
    setup({ payments_enabled: true })
    fireEvent.click(screen.getByRole('button', { name: UPGRADE }))

    expect(startCheckout).toHaveBeenCalledWith('pro')
    expect(upgrade).not.toHaveBeenCalled()
  })

  it('keeps the demo mock when Stripe is not configured', () => {
    // Without this branch a demo install would post to /checkout and get a 400
    // instead of the tier flip it has always had.
    setup({ payments_enabled: false })
    fireEvent.click(screen.getByRole('button', { name: UPGRADE }))

    expect(upgrade).toHaveBeenCalledWith('pro')
    expect(startCheckout).not.toHaveBeenCalled()
  })

  it('cancels through the portal instead of flipping the column locally', () => {
    // Choosing Free while paying is a CANCELLATION. The mock upgrade would set
    // the tier while Stripe kept billing — the two would disagree until someone
    // noticed on the invoice.
    setup({ payments_enabled: true, has_subscription: true, tier: 'pro' })
    fireEvent.click(screen.getByRole('button', { name: SWITCH }))

    expect(openPortal).toHaveBeenCalled()
    expect(upgrade).not.toHaveBeenCalled()
  })

  it('offers the portal to a subscriber', () => {
    setup({ payments_enabled: true, has_subscription: true, tier: 'pro' })
    fireEvent.click(screen.getByRole('button', { name: MANAGE }))
    expect(openPortal).toHaveBeenCalled()
  })

  it('offers nothing to manage before the first payment', () => {
    setup({ payments_enabled: true, has_subscription: false })
    expect(screen.queryByRole('button', { name: MANAGE })).not.toBeInTheDocument()
  })
})
