import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { Insight } from '../types'
import * as api from '../api/insight'

interface InsightState {
  items: Insight[]
  generating: boolean
  load: () => Promise<void>
  generate: () => Promise<void>
  dismiss: (id: string) => Promise<void>
}

export const useInsightStore = create<InsightState>((set, get) => ({
  items: [],
  generating: false,
  load: async () => {
    set({ items: await api.list() })
  },
  generate: async () => {
    if (get().generating) return
    set({ generating: true })
    try {
      const { created } = await api.generate()
      await get().load()
      toast(created > 0 ? `${created} yeni kəşf ✨` : 'Yeni kəşf tapılmadı.', { icon: '🔍' })
    } catch {
      /* interceptor toast */
    } finally {
      set({ generating: false })
    }
  },
  dismiss: async (id) => {
    set({ items: get().items.filter((i) => i.id !== id) })
    await api.dismiss(id).catch(() => undefined)
  },
}))
