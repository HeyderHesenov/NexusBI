import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { ContractRun, DataContract, DataContractCreate } from '../types'
import * as api from '../api/dataContract'

interface DataContractState {
  items: DataContract[]
  runsById: Record<string, ContractRun[]>
  load: () => Promise<void>
  add: (payload: DataContractCreate) => Promise<void>
  run: (id: string) => Promise<void>
  loadRuns: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useDataContractStore = create<DataContractState>((set, get) => ({
  items: [],
  runsById: {},
  load: async () => {
    set({ items: await api.list() })
  },
  add: async (payload) => {
    const c = await api.create(payload)
    set({ items: [c, ...get().items] })
    toast.success('Müqavilə yaradıldı.')
  },
  run: async (id) => {
    const updated = await api.run(id)
    set({ items: get().items.map((c) => (c.id === id ? updated : c)) })
    await get().loadRuns(id)
    toast(updated.last_status === 'pass' ? 'Bütün yoxlamalar keçdi ✓' : 'Pozulma var ⚠️', {
      icon: updated.last_status === 'pass' ? '✅' : '⚠️',
    })
  },
  loadRuns: async (id) => {
    set({ runsById: { ...get().runsById, [id]: await api.runs(id) } })
  },
  remove: async (id) => {
    await api.remove(id)
    set({ items: get().items.filter((c) => c.id !== id) })
  },
}))
