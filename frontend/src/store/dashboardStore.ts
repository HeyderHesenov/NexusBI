import { create } from 'zustand'
import type { Dashboard, DashboardSummary } from '../types'
import * as dashApi from '../api/dashboard'

interface DashboardState {
  list: DashboardSummary[]
  current: Dashboard | null
  loadList: () => Promise<void>
  open: (id: string) => Promise<void>
  create: (name: string) => Promise<Dashboard>
  addWidget: (dashboardId: string, queryLogId: string, title: string) => Promise<void>
  removeWidget: (dashboardId: string, widgetId: string) => Promise<void>
  saveLayout: (dashboardId: string, layout: Record<string, unknown>) => Promise<void>
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  list: [],
  current: null,
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
  saveLayout: async (dashboardId, layout) => {
    await dashApi.updateDashboard(dashboardId, { layout })
  },
}))
