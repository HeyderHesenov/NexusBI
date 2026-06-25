import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { Decision, DecisionCreate, DecisionStatus } from '../types'
import * as api from '../api/decision'

interface DecisionState {
  items: Decision[]
  load: () => Promise<void>
  add: (payload: DecisionCreate) => Promise<void>
  patch: (id: string, p: { status?: DecisionStatus; outcome?: string }) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useDecisionStore = create<DecisionState>((set, get) => ({
  items: [],
  load: async () => {
    set({ items: await api.list() })
  },
  add: async (payload) => {
    const d = await api.create(payload)
    set({ items: [d, ...get().items] })
    toast.success('Qərar yaradıldı.')
  },
  patch: async (id, p) => {
    const updated = await api.update(id, p)
    set({ items: get().items.map((d) => (d.id === id ? updated : d)) })
  },
  remove: async (id) => {
    await api.remove(id)
    set({ items: get().items.filter((d) => d.id !== id) })
  },
}))
