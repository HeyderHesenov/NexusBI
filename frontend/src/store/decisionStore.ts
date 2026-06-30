import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { AccuracySummary, Decision, DecisionCreate, DecisionROI, DecisionStatus } from '../types'
import * as api from '../api/decision'

function applyRoi(d: Decision, r: DecisionROI): Decision {
  return {
    ...d,
    baseline_value: r.baseline_value,
    baseline_at: r.baseline_at,
    realized_value: r.realized_value,
    realized_at: r.realized_at,
    impact_status: r.impact_status,
  }
}

interface DecisionState {
  items: Decision[]
  accuracy: AccuracySummary | null
  load: () => Promise<void>
  loadAccuracy: () => Promise<void>
  add: (payload: DecisionCreate) => Promise<void>
  patch: (id: string, p: { status?: DecisionStatus; outcome?: string }) => Promise<void>
  measure: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useDecisionStore = create<DecisionState>((set, get) => ({
  items: [],
  accuracy: null,
  load: async () => {
    set({ items: await api.list() })
  },
  loadAccuracy: async () => {
    set({ accuracy: await api.accuracy() })
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
  measure: async (id) => {
    const roi = await api.measure(id)
    set({ items: get().items.map((d) => (d.id === id ? applyRoi(d, roi) : d)) })
    await get().loadAccuracy()
    toast.success('Təsir ölçüldü.')
  },
  remove: async (id) => {
    await api.remove(id)
    set({ items: get().items.filter((d) => d.id !== id) })
  },
}))
