import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { Dashboard, DashboardFilterSpec, DashboardSummary, WidgetChart } from '../types'
import * as dashApi from '../api/dashboard'

interface LiveWidgetUpdate {
  widget_id: string
  chart: WidgetChart
}

/** A filter is "active" when it constrains something — a dated range or at least
 *  one dimension with selected values. An all-empty spec is treated as cleared. */
export function isFilterActive(spec: DashboardFilterSpec | null | undefined): boolean {
  if (!spec) return false
  const dated = !!spec.date_column && !!(spec.date_start || spec.date_end)
  const sliced = (spec.dimensions ?? []).some((d) => d.values.length > 0)
  return dated || sliced
}

/** Swap each widget's chart for its filtered version. A widget PRESENT in the
 *  response with a null chart (filtered to empty / RLS-skipped) must show
 *  empty — not stale unfiltered data; a widget ABSENT keeps its chart.
 *  Shared by the owner store and the public/embed pages. */
export function mergeFilteredWidgets<T extends { id: string; chart: WidgetChart | null }>(
  widgets: T[],
  updates: dashApi.FilteredWidget[],
): T[] {
  const byId = new Map(updates.map((u) => [u.widget_id, u.chart]))
  return widgets.map((w) => (byId.has(w.id) ? { ...w, chart: byId.get(w.id) ?? null } : w))
}

interface DashboardState {
  list: DashboardSummary[]
  current: Dashboard | null
  refreshing: boolean
  /** The dashboard's active global filter (mirrors current.global_filter). */
  globalFilter: DashboardFilterSpec | null
  /** True while a global-filter re-run is in flight. */
  filtering: boolean
  /** Per-widget counter, bumped on every live data push — drives the flash. */
  pulses: Record<string, number>
  loadList: () => Promise<void>
  open: (id: string) => Promise<void>
  create: (name: string) => Promise<Dashboard>
  generate: (goal: string, datasourceId: string | null) => Promise<Dashboard>
  remove: (id: string) => Promise<void>
  addWidget: (dashboardId: string, queryLogId: string, title: string) => Promise<void>
  removeWidget: (dashboardId: string, widgetId: string) => Promise<void>
  refreshWidget: (dashboardId: string, widgetId: string) => Promise<void>
  refreshAll: (dashboardId: string) => Promise<void>
  applyGlobalFilter: (dashboardId: string, spec: DashboardFilterSpec) => Promise<void>
  saveLayout: (dashboardId: string, layout: Record<string, unknown>) => Promise<void>
  toggleLive: (dashboardId: string, enabled: boolean, intervalSeconds?: number) => Promise<void>
  applyLiveUpdate: (dashboardId: string, updates: LiveWidgetUpdate[]) => void
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  list: [],
  current: null,
  refreshing: false,
  globalFilter: null,
  filtering: false,
  pulses: {},
  loadList: async () => {
    set({ list: await dashApi.listDashboards() })
  },
  open: async (id) => {
    const dash = await dashApi.getDashboard(id)
    set({ current: dash, globalFilter: dash.global_filter ?? null })
    // Stored widget snapshots are unfiltered; re-run with the saved filter so the
    // view matches the persisted selection.
    if (isFilterActive(dash.global_filter)) {
      get()
        .applyGlobalFilter(id, dash.global_filter as DashboardFilterSpec)
        .catch(() => undefined)
    }
  },
  create: async (name) => {
    const dash = await dashApi.createDashboard(name)
    set((s) => ({ list: [...s.list, { id: dash.id, name: dash.name, description: dash.description }] }))
    return dash
  },
  generate: async (goal, datasourceId) => {
    const dash = await dashApi.generateDashboard(goal, datasourceId)
    set((s) => ({
      list: [...s.list, { id: dash.id, name: dash.name, description: dash.description }],
      current: dash,
      // A fresh dashboard starts from its own (empty) filter, not the last one's.
      globalFilter: dash.global_filter ?? null,
    }))
    return dash
  },
  remove: async (id) => {
    await dashApi.deleteDashboard(id)
    set((s) => ({
      list: s.list.filter((d) => d.id !== id),
      current: s.current?.id === id ? null : s.current,
    }))
    toast.success('Dashboard silindi.')
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
  applyGlobalFilter: async (dashboardId, spec) => {
    set({ filtering: true })
    try {
      const result = await dashApi.applyFilter(dashboardId, spec)
      set((s) => {
        // The user navigated away mid-flight (open() auto-apply race) — don't
        // clobber the now-current dashboard's filter with this stale result.
        if (s.current?.id !== dashboardId) return {}
        return {
          globalFilter: result.global_filter,
          current: {
            ...s.current,
            global_filter: result.global_filter,
            widgets: mergeFilteredWidgets(s.current.widgets, result.widgets),
          },
        }
      })
    } catch {
      /* interceptor toast */
    } finally {
      set({ filtering: false })
    }
  },
  saveLayout: async (dashboardId, layout) => {
    await dashApi.updateDashboard(dashboardId, { layout })
  },
  toggleLive: async (dashboardId, enabled, intervalSeconds) => {
    const dash = await dashApi.setLive(dashboardId, enabled, intervalSeconds)
    const cur = get().current
    if (cur?.id === dashboardId) {
      set({
        current: {
          ...cur,
          live_enabled: dash.live_enabled,
          live_interval_seconds: dash.live_interval_seconds,
        },
      })
    }
    toast.success(enabled ? 'Canlı rejim aktiv.' : 'Canlı rejim söndürüldü.')
  },
  applyLiveUpdate: (dashboardId, updates) => {
    const cur = get().current
    if (cur?.id !== dashboardId || updates.length === 0) return
    const byId = new Map(updates.map((u) => [u.widget_id, u.chart]))
    set((s) => {
      const pulses = { ...s.pulses }
      for (const u of updates) pulses[u.widget_id] = (pulses[u.widget_id] ?? 0) + 1
      return {
        pulses,
        current: cur && {
          ...cur,
          widgets: cur.widgets.map((w) =>
            byId.has(w.id) ? { ...w, chart: byId.get(w.id)! } : w,
          ),
        },
      }
    })
  },
}))
