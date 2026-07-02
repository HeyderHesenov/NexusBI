import { create } from 'zustand'
import toast from 'react-hot-toast'
import i18n from '../i18n'
import type { SnapshotFull, SnapshotMeta } from '../types'
import * as api from '../api/snapshot'

interface SnapshotState {
  dashboardId: string | null
  items: SnapshotMeta[]
  selected: SnapshotFull | null
  loading: boolean
  capturing: boolean
  load: (dashboardId: string) => Promise<void>
  capture: (dashboardId: string, label?: string) => Promise<void>
  select: (dashboardId: string, snapshotId: string) => Promise<void>
  clearSelection: () => void
  remove: (dashboardId: string, snapshotId: string) => Promise<void>
  reset: () => void
}

export const useSnapshotStore = create<SnapshotState>((set, get) => ({
  dashboardId: null,
  items: [],
  selected: null,
  loading: false,
  capturing: false,
  load: async (dashboardId) => {
    set({ dashboardId, loading: true })
    try {
      const items = await api.list(dashboardId)
      // Staleness guard: the user may have switched dashboards mid-flight.
      if (get().dashboardId === dashboardId) set({ items })
    } finally {
      if (get().dashboardId === dashboardId) set({ loading: false })
    }
  },
  capture: async (dashboardId, label = '') => {
    set({ capturing: true })
    try {
      await api.capture(dashboardId, label)
      await get().load(dashboardId)
      toast.success(i18n.t('timeMachine.captured'))
    } finally {
      set({ capturing: false })
    }
  },
  select: async (dashboardId, snapshotId) => {
    const full = await api.get(dashboardId, snapshotId)
    if (get().dashboardId === dashboardId) set({ selected: full })
  },
  clearSelection: () => set({ selected: null }),
  remove: async (dashboardId, snapshotId) => {
    await api.remove(dashboardId, snapshotId)
    const { selected } = get()
    if (selected?.id === snapshotId) set({ selected: null })
    await get().load(dashboardId)
  },
  reset: () =>
    set({ dashboardId: null, items: [], selected: null, loading: false, capturing: false }),
}))
