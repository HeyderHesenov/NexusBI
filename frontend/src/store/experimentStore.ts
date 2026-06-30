import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { Experiment, ExperimentCreate } from '../types'
import * as api from '../api/experiment'

interface ExperimentState {
  items: Experiment[]
  load: () => Promise<void>
  add: (payload: ExperimentCreate) => Promise<void>
  analyze: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useExperimentStore = create<ExperimentState>((set, get) => ({
  items: [],
  load: async () => {
    set({ items: await api.list() })
  },
  add: async (payload) => {
    const e = await api.create(payload)
    set({ items: [e, ...get().items] })
    toast.success('Eksperiment yaradıldı.')
  },
  analyze: async (id) => {
    const updated = await api.analyze(id)
    set({ items: get().items.map((e) => (e.id === id ? updated : e)) })
  },
  remove: async (id) => {
    await api.remove(id)
    set({ items: get().items.filter((e) => e.id !== id) })
  },
}))
