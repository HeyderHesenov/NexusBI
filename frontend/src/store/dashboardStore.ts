import { create } from 'zustand'
import type { Dashboard, DashboardSummary } from '../types'
import * as dashApi from '../api/dashboard'

interface DashboardState {
  list: DashboardSummary[]
  current: Dashboard | null
  loadList: () => Promise<void>
  open: (id: string) => Promise<void>
  create: (name: string) => Promise<Dashboard>
}

export const useDashboardStore = create<DashboardState>((set) => ({
  list: [],
  current: null,
  loadList: async () => {
    const list = await dashApi.listDashboards()
    set({ list })
  },
  open: async (id) => {
    const current = await dashApi.getDashboard(id)
    set({ current })
  },
  create: async (name) => {
    const dash = await dashApi.createDashboard(name)
    set((s) => ({ list: [...s.list, dash] }))
    return dash
  },
}))
