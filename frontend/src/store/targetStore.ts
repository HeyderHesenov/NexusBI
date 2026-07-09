import { create } from 'zustand'
import toast from 'react-hot-toast'
import * as api from '../api/scenario'
import type { KPITarget } from '../api/scenario'

interface TargetState {
  items: KPITarget[]
  /** Fetch targets. Deduped: repeat calls reuse the first result/in-flight
   *  request so every chart surface can call it on mount without N× GETs.
   *  Pass force=true after mutations to actually refetch. */
  load: (force?: boolean) => Promise<void>
  add: (payload: { name: string; target_value: number; current_value: number; period: string }) => Promise<void>
  update: (id: string, payload: Partial<{ current_value: number; target_value: number }>) => Promise<void>
  remove: (id: string) => Promise<void>
}

let loadPromise: Promise<void> | null = null

export const useTargetStore = create<TargetState>((set, get) => ({
  items: [],
  load: (force = false) => {
    if (!force && loadPromise) return loadPromise
    loadPromise = api
      .listTargets()
      .then((items) => set({ items }))
      .catch((err) => {
        loadPromise = null // failed loads may retry on the next mount
        throw err
      })
    return loadPromise
  },
  add: async (payload) => {
    await api.createTarget(payload)
    await get().load(true)
    toast.success('Hədəf əlavə olundu.')
  },
  update: async (id, payload) => {
    const updated = await api.updateTarget(id, payload)
    set({ items: get().items.map((t) => (t.id === id ? updated : t)) })
  },
  remove: async (id) => {
    await api.deleteTarget(id)
    set({ items: get().items.filter((t) => t.id !== id) })
  },
}))
