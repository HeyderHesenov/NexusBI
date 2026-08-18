import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { Plan, Usage } from '../types'
import * as billingApi from '../api/billing'
import { useAuthStore } from './authStore'

interface BillingState {
  plans: Plan[]
  usage: Usage | null
  loading: boolean
  loadPlans: () => Promise<void>
  loadUsage: () => Promise<void>
  /** Demo-only mock: the server refuses this outside DEMO_MODE. */
  upgrade: (tier: string) => Promise<void>
  /** Real payment: leaves the app for Stripe's hosted checkout. */
  startCheckout: (tier: string) => Promise<void>
  /** Stripe's hosted portal — the only place a customer can cancel or fix a card. */
  openPortal: () => Promise<void>
  /** Re-enable the buttons after a hand-off the user came back from. */
  armButtons: () => void
}

/** Hop to a hosted payment page. One named seam rather than two inline calls:
 *  jsdom refuses real navigation, so the tests replace `location` and read back
 *  the URL — which is the only way to prove the user is sent to the address the
 *  SERVER returned rather than to one the client assembled. */
export function leaveTo(url: string): void {
  window.location.assign(url)
}

export const useBillingStore = create<BillingState>((set, get) => ({
  plans: [],
  usage: null,
  loading: false,
  loadPlans: async () => {
    if (get().plans.length) return
    set({ plans: await billingApi.getPlans() })
  },
  loadUsage: async () => {
    set({ usage: await billingApi.getUsage() })
  },
  startCheckout: async (tier) => {
    if (get().loading) return
    set({ loading: true })
    try {
      // No `finally { loading: false }` on the success path: the tab is leaving,
      // and re-enabling the button first invites a second checkout session. The
      // way BACK is `armButtons`, called on bfcache restore — see PricingPage.
      leaveTo(await billingApi.checkout(tier))
    } catch {
      set({ loading: false }) // stayed on the page — the error toast came from the interceptor
    }
  },
  openPortal: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      leaveTo(await billingApi.portal())
    } catch {
      set({ loading: false })
    }
  },
  armButtons: () => set({ loading: false }),
  upgrade: async (tier) => {
    set({ loading: true })
    try {
      const usage = await billingApi.upgrade(tier)
      set({ usage })
      // Keep the auth user's tier (badge in TopBar) in sync.
      await useAuthStore.getState().loadUser()
      toast.success(`${usage.tier_name} planına keçdiniz.`)
    } finally {
      set({ loading: false })
    }
  },
}))
