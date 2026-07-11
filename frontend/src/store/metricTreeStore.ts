import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { EvaluatedNode, MetricNodeCreate, TreeOperator } from '../types'
import * as api from '../api/metricTree'
import i18n from '../i18n'

interface MetricTreeState {
  forest: EvaluatedNode[]
  load: () => Promise<void>
  add: (payload: MetricNodeCreate) => Promise<void>
  edit: (id: string, payload: { name?: string; operator?: TreeOperator; manual_value?: number | null }) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useMetricTreeStore = create<MetricTreeState>((set, get) => ({
  forest: [],
  load: async () => {
    set({ forest: await api.evaluate() })
  },
  add: async (payload) => {
    await api.create(payload)
    await get().load()
    toast.success(i18n.t('metricTreePage.nodeAdded'))
  },
  edit: async (id, payload) => {
    await api.update(id, payload)
    await get().load()
  },
  remove: async (id) => {
    await api.remove(id)
    await get().load()
  },
}))
