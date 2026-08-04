import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { BindableSource, EvaluatedNode, MetricNodeCreate, MetricNodeUpdate } from '../types'
import * as api from '../api/metricTree'
import i18n from '../i18n'

interface MetricTreeState {
  forest: EvaluatedNode[]
  /** Saved queries a leaf can measure from. Loaded on demand by the editor. */
  sources: BindableSource[]
  load: () => Promise<void>
  loadSources: () => Promise<void>
  add: (payload: MetricNodeCreate) => Promise<void>
  edit: (id: string, payload: MetricNodeUpdate) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useMetricTreeStore = create<MetricTreeState>((set, get) => ({
  forest: [],
  sources: [],
  load: async () => {
    set({ forest: await api.evaluate() })
  },
  loadSources: async () => {
    set({ sources: await api.bindable() })
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
