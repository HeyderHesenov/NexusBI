import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { SavedQuery, SavedQueryCreate, Schedule } from '../types'
import * as api from '../api/savedQuery'

interface SavedQueryState {
  items: SavedQuery[]
  loading: boolean
  load: () => Promise<void>
  save: (payload: SavedQueryCreate) => Promise<void>
  setSchedule: (id: string, schedule: Schedule) => Promise<void>
  remove: (id: string) => Promise<void>
  run: (id: string) => Promise<void>
}

export const useSavedQueryStore = create<SavedQueryState>((set, get) => ({
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
  save: async (payload) => {
    const sq = await api.create(payload)
    set({ items: [sq, ...get().items] })
    toast.success('Sorğu saxlanıldı.')
  },
  setSchedule: async (id, schedule) => {
    const updated = await api.update(id, { schedule })
    set({ items: get().items.map((s) => (s.id === id ? updated : s)) })
  },
  remove: async (id) => {
    await api.remove(id)
    set({ items: get().items.filter((s) => s.id !== id) })
  },
  run: async (id) => {
    try {
      await api.run(id)
      await get().load()
      toast.success('İşlədildi.')
    } catch {
      /* interceptor toast */
    }
  },
}))
