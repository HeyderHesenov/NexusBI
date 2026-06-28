import { create } from 'zustand'
import toast from 'react-hot-toast'
import * as api from '../api/scenario'
import type { KPITarget } from '../api/scenario'

interface TargetState {
  items: KPITarget[]
  load: () => Promise<void>
  add: (payload: { name: string; target_value: number; current_value: number; period: string }) => Promise<void>
  update: (id: string, payload: Partial<{ current_value: number; target_value: number }>) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useTargetStore = create<TargetState>((set, get) => ({
  items: [],
  load: async () => set({ items: await api.listTargets() }),
  add: async (payload) => {
    await api.createTarget(payload)
    await get().load()
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
