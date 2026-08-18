import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { Dashboard, RequirementDoc } from '../types'
import * as api from '../api/requirement'
import * as decisionApi from '../api/decision'

interface RequirementState {
  doc: RequirementDoc | null
  extracting: boolean
  building: boolean
  /** `${docId}:${index}` while that one KPI is being promoted — a global flag
   *  would grey out every other KPI's button at the same time. */
  promoting: string | null
  measuring: string | null
  extract: (name: string, text: string) => Promise<void>
  build: (datasourceId: string | null, questions: string[]) => Promise<Dashboard | null>
  promote: (body: api.PromoteKpiBody) => Promise<void>
  measureKpi: (decisionId: string) => Promise<void>
  reset: () => void
}

export const useRequirementStore = create<RequirementState>((set, get) => ({
  doc: null,
  extracting: false,
  building: false,
  promoting: null,
  measuring: null,
  extract: async (name, text) => {
    if (get().extracting) return
    set({ extracting: true })
    try {
      const doc = await api.extractRequirements(name, text)
      set({ doc })
      if (!doc.kpis.length) toast('KPI tapılmadı — mətni dəqiqləşdir.')
    } catch {
      /* interceptor toast */
    } finally {
      set({ extracting: false })
    }
  },
  build: async (datasourceId, questions) => {
    const doc = get().doc
    if (!doc || get().building) return null
    set({ building: true })
    try {
      const dash = await api.buildFromRequirement(doc.id, datasourceId, questions)
      toast.success('Dashboard quruldu')
      return dash
    } catch {
      return null
    } finally {
      set({ building: false })
    }
  },
  promote: async (body) => {
    const doc = get().doc
    if (!doc || get().promoting) return
    set({ promoting: `${doc.id}:${body.kpi_index}` })
    try {
      const res = await api.promoteKpi(doc.id, body)
      // The server's document, not a locally patched one: it already carries the
      // link and the freshly captured outcome, so there is nothing to guess.
      set({ doc: res.requirement })
    } catch {
      /* interceptor toast */
    } finally {
      set({ promoting: null })
    }
  },
  measureKpi: async (decisionId) => {
    const doc = get().doc
    if (!doc || get().measuring) return
    set({ measuring: decisionId })
    try {
      await decisionApi.measure(decisionId)
      // Re-read rather than patch from the measure response: DecisionROI carries
      // the values but no data_as_of, so patching locally would drop the
      // freshness signal on the one path where the number just changed.
      set({ doc: await api.getRequirement(doc.id) })
    } catch {
      /* interceptor toast */
    } finally {
      set({ measuring: null })
    }
  },
  reset: () => set({ doc: null }),
}))
