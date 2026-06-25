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
  upgrade: (tier: string) => Promise<void>
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
