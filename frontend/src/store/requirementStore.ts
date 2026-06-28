import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { Dashboard, RequirementDoc } from '../types'
import * as api from '../api/requirement'

interface RequirementState {
  doc: RequirementDoc | null
  extracting: boolean
  building: boolean
  extract: (name: string, text: string) => Promise<void>
  build: (datasourceId: string | null, questions: string[]) => Promise<Dashboard | null>
  reset: () => void
}

export const useRequirementStore = create<RequirementState>((set, get) => ({
  doc: null,
  extracting: false,
  building: false,
  extract: async (name, text) => {
    if (get().extracting) return
    set({ extracting: true })
    try {
      const doc = await api.extractRequirements(name, text)
      set({ doc })
      if (!doc.kpis.length) toast('KPI tapılmadı — mətni dəqiqləşdir.', { icon: 'ℹ️' })
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
      toast.success('Dashboard quruldu 🎉')
      return dash
    } catch {
      return null
    } finally {
      set({ building: false })
    }
  },
  reset: () => set({ doc: null }),
}))
