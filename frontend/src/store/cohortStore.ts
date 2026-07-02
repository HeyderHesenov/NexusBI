import { create } from 'zustand'
import type { CohortData, FunnelStep } from '../types'
import * as api from '../api/cohort'

interface CohortState {
  retention: CohortData | null
  funnel: FunnelStep[]
  loading: boolean
  error: boolean
  load: () => Promise<void>
}

export const useCohortStore = create<CohortState>((set) => ({
  retention: null,
  funnel: [],
  loading: false,
  error: false,
  load: async () => {
    set({ loading: true, error: false })
    try {
      const [retention, funnel] = await Promise.all([api.retention(), api.funnel()])
      set({ retention, funnel })
    } catch {
      // The axios interceptor already toasts; keep a flag so the page can
      // distinguish "outage" from "genuinely empty dataset".
      set({ error: true })
    } finally {
      set({ loading: false })
    }
  },
}))
