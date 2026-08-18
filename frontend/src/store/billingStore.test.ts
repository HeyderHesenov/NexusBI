import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../api/billing', () => ({
  getPlans: vi.fn(),
  getUsage: vi.fn(),
  upgrade: vi.fn(),
  checkout: vi.fn(),
  portal: vi.fn(),
}))
vi.mock('./authStore', () => ({
  useAuthStore: { getState: () => ({ loadUser: vi.fn() }) },
}))

import { useBillingStore } from './billingStore'
import * as api from '../api/billing'

const checkout = vi.mocked(api.checkout)
const portal = vi.mocked(api.portal)
const upgrade = vi.mocked(api.upgrade)

let assign: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  useBillingStore.setState({ plans: [], usage: null, loading: false })
  // jsdom refuses real navigation, so `location` is replaced wholesale. Reading
  // the argument back is what proves the user is sent to the SERVER's URL.
  assign = vi.fn()
  vi.stubGlobal('location', { ...window.location, assign })
})

afterEach(() => vi.unstubAllGlobals())

describe('billingStore.startCheckout', () => {
  it('sends the user to the URL Stripe returned', async () => {
    checkout.mockResolvedValue('https://checkout.stripe.test/c/pay_1')
    await useBillingStore.getState().startCheckout('pro')

    expect(checkout).toHaveBeenCalledWith('pro')
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/c/pay_1')
  })

  it('stays put and re-arms the button when the server refuses', async () => {
    checkout.mockRejectedValue(new Error('stripe_not_configured'))
    await useBillingStore.getState().startCheckout('pro')

    expect(assign).not.toHaveBeenCalled()
    expect(useBillingStore.getState().loading).toBe(false)
  })

  it('does not open a second checkout while one is in flight', async () => {
    // The tab is on its way out; a second session would be a second subscription.
    let release!: (url: string) => void
    checkout.mockImplementation(() => new Promise((r) => (release = r)))

    const first = useBillingStore.getState().startCheckout('pro')
    await useBillingStore.getState().startCheckout('max')
    expect(checkout).toHaveBeenCalledTimes(1)

    release('https://checkout.stripe.test/c/pay_1')
    await first
  })

  it('leaves the button disabled after a successful hand-off', async () => {
    checkout.mockResolvedValue('https://checkout.stripe.test/c/pay_1')
    await useBillingStore.getState().startCheckout('pro')
    expect(useBillingStore.getState().loading).toBe(true)
  })
})

describe('billingStore.openPortal', () => {
  it('sends the user to the portal URL the server returned', async () => {
    portal.mockResolvedValue('https://billing.stripe.test/session')
    await useBillingStore.getState().openPortal()

    expect(portal).toHaveBeenCalled()
    expect(assign).toHaveBeenCalledWith('https://billing.stripe.test/session')
  })

  it('stays put when the user has no subscription to manage', async () => {
    portal.mockRejectedValue(new Error('no_subscription'))
    await useBillingStore.getState().openPortal()

    expect(assign).not.toHaveBeenCalled()
    expect(useBillingStore.getState().loading).toBe(false)
  })
})

describe('billingStore.upgrade', () => {
  it('is the mock path and never navigates', async () => {
    upgrade.mockResolvedValue({ tier: 'pro', tier_name: 'Pro' } as never)
    await useBillingStore.getState().upgrade('pro')

    expect(upgrade).toHaveBeenCalledWith('pro')
    expect(assign).not.toHaveBeenCalled()
    expect(checkout).not.toHaveBeenCalled()
  })
})
