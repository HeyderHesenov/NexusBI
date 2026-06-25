import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { Metric, MetricCreate } from '../types'
import * as api from '../api/metric'

interface MetricState {
  items: Metric[]
  loading: boolean
  load: () => Promise<void>
  add: (payload: MetricCreate) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useMetricStore = create<MetricState>((set, get) => ({
  items: [],
  loading: false,
  load: async () => {
    set({ loading: true })
    try {
      set({ items: await api.list() })
    } finally {
      set({ loading: false })
    }
  },
  add: async (payload) => {
    const m = await api.create(payload)
    set({ items: [m, ...get().items] })
    toast.success('Metrik əlavə olundu.')
  },
  remove: async (id) => {
    await api.remove(id)
    set({ items: get().items.filter((m) => m.id !== id) })
  },
}))
