import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Plan, Usage } from '../types'

const upgrade = vi.fn()
const startCheckout = vi.fn()
const openPortal = vi.fn()
const armButtons = vi.fn()
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
  has_billing_account: false,
  ...over,
})

const setup = (over: Partial<Usage> = {}) => {
  upgrade.mockReset()
  startCheckout.mockReset()
  openPortal.mockReset()
  armButtons.mockReset()
  state = {
    plans: [plan('free', 0), plan('pro', 20)],
    usage: usage(over),
    loading: false,
    loadPlans: loadPlans.mockResolvedValue(undefined),
    loadUsage: loadUsage.mockResolvedValue(undefined),
    upgrade,
    startCheckout,
    openPortal,
    armButtons,
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

  it('sends every change through the portal while a subscription is live', () => {
    // Choosing Free while paying is a CANCELLATION, and choosing another paid
    // plan is a SWITCH — Stripe does not replace a subscription when a second
    // session completes, it bills both. Both belong in the portal.
    setup({ payments_enabled: true, has_subscription: true, has_billing_account: true, tier: 'pro' })
    fireEvent.click(screen.getByRole('button', { name: SWITCH }))
    expect(openPortal).toHaveBeenCalled()
    expect(upgrade).not.toHaveBeenCalled()
    expect(startCheckout).not.toHaveBeenCalled()
  })

  it('does not offer a dead button when there is nothing to switch to', () => {
    // payments on, no customer, tier set outside Stripe (demo upgrade, or by
    // hand): "Switch to Free" had nothing to call and said nothing about it.
    setup({ payments_enabled: true, has_subscription: false, tier: 'pro' })
    expect(screen.getByRole('button', { name: SWITCH })).toBeDisabled()
  })

  it('re-arms the buttons when the browser restores the page from bfcache', () => {
    // Back from Stripe restores this exact tree — same store, nothing remounts —
    // so without this the page comes back with every button dead.
    setup({ payments_enabled: true })
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    expect(armButtons).toHaveBeenCalled()
  })

  it('does not re-arm on an ordinary load', () => {
    setup({ payments_enabled: true })
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }))
    expect(armButtons).not.toHaveBeenCalled()
  })

  it('offers the portal to a subscriber', () => {
    setup({ payments_enabled: true, has_subscription: true, has_billing_account: true, tier: 'pro' })
    fireEvent.click(screen.getByRole('button', { name: MANAGE }))
    expect(openPortal).toHaveBeenCalled()
  })

  it('keeps the portal reachable after a cancellation', () => {
    // The customer outlives the subscription: invoices to read, a card on file.
    setup({ payments_enabled: true, has_subscription: false, has_billing_account: true })
    fireEvent.click(screen.getByRole('button', { name: MANAGE }))
    expect(openPortal).toHaveBeenCalled()
  })

  it('offers nothing to manage before the first payment', () => {
    setup({ payments_enabled: true, has_subscription: false })
    expect(screen.queryByRole('button', { name: MANAGE })).not.toBeInTheDocument()
  })
})
