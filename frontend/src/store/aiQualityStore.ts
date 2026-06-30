import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { EvalRun, ObservabilitySummary } from '../types'
import * as api from '../api/aiQuality'

interface AIQualityState {
  runs: EvalRun[]
  obs: ObservabilitySummary | null
  busy: boolean
  load: () => Promise<void>
  runEval: () => Promise<void>
  reindex: () => Promise<void>
}

export const useAIQualityStore = create<AIQualityState>((set, get) => ({
  runs: [],
  obs: null,
  busy: false,
  load: async () => {
    const [runs, obs] = await Promise.all([api.listRuns(), api.observability()])
    set({ runs, obs })
  },
  runEval: async () => {
    if (get().busy) return
    set({ busy: true })
    try {
      const run = await api.runEval()
      set({ runs: [run, ...get().runs] })
      toast.success(`Eval: ${run.passed}/${run.total} keçdi (${Math.round(run.exec_accuracy * 100)}%)`)
    } catch {
      /* interceptor toast */
    } finally {
      set({ busy: false })
    }
  },
  reindex: async () => {
    if (get().busy) return
    set({ busy: true })
    try {
      const { indexed } = await api.reindex()
      toast.success(`${indexed} element indeksləndi.`)
    } catch {
      /* interceptor toast */
    } finally {
      set({ busy: false })
    }
  },
}))
