import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { Dashboard, DashboardSummary } from '../types'
import * as dashApi from '../api/dashboard'

interface DashboardState {
  list: DashboardSummary[]
  current: Dashboard | null
  refreshing: boolean
  loadList: () => Promise<void>
  open: (id: string) => Promise<void>
  create: (name: string) => Promise<Dashboard>
  addWidget: (dashboardId: string, queryLogId: string, title: string) => Promise<void>
  removeWidget: (dashboardId: string, widgetId: string) => Promise<void>
  refreshWidget: (dashboardId: string, widgetId: string) => Promise<void>
  refreshAll: (dashboardId: string) => Promise<void>
  saveLayout: (dashboardId: string, layout: Record<string, unknown>) => Promise<void>
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  list: [],
  current: null,
  refreshing: false,
  loadList: async () => {
    set({ list: await dashApi.listDashboards() })
  },
  open: async (id) => {
    set({ current: await dashApi.getDashboard(id) })
  },
  create: async (name) => {
    const dash = await dashApi.createDashboard(name)
    set((s) => ({ list: [...s.list, { id: dash.id, name: dash.name, description: dash.description }] }))
    return dash
  },
  addWidget: async (dashboardId, queryLogId, title) => {
    const widget = await dashApi.addWidget(dashboardId, { query_log_id: queryLogId, title })
    const cur = get().current
    if (cur?.id === dashboardId) {
      set({ current: { ...cur, widgets: [...cur.widgets, widget] } })
    }
  },
  removeWidget: async (dashboardId, widgetId) => {
    await dashApi.removeWidget(dashboardId, widgetId)
    const cur = get().current
    if (cur?.id === dashboardId) {
      set({ current: { ...cur, widgets: cur.widgets.filter((w) => w.id !== widgetId) } })
    }
  },
  refreshWidget: async (dashboardId, widgetId) => {
    const updated = await dashApi.refreshWidget(dashboardId, widgetId)
    const cur = get().current
    if (cur?.id === dashboardId) {
      set({
        current: {
          ...cur,
          widgets: cur.widgets.map((w) => (w.id === widgetId ? updated : w)),
        },
      })
    }
  },
  refreshAll: async (dashboardId) => {
    set({ refreshing: true })
    try {
      const dash = await dashApi.refreshAll(dashboardId)
      if (get().current?.id === dashboardId) set({ current: dash })
      toast.success('Bütün widgetlər yeniləndi.')
    } catch {
      /* interceptor toast */
    } finally {
      set({ refreshing: false })
    }
  },
  saveLayout: async (dashboardId, layout) => {
    await dashApi.updateDashboard(dashboardId, { layout })
  },
}))
