import { create } from 'zustand'
import type { BAArtifact, BAFramework } from '../types'
import * as api from '../api/ba'

interface BAState {
  items: BAArtifact[]
  /** The artifact currently shown on the canvas (freshly generated or picked from the list). */
  current: BAArtifact | null
  generating: boolean
  load: () => Promise<void>
  generate: (framework: BAFramework, title: string, context: string) => Promise<void>
  select: (id: string) => void
  remove: (id: string) => Promise<void>
}

export const useBAStore = create<BAState>((set, get) => ({
  items: [],
  current: null,
  generating: false,
  load: async () => {
    set({ items: await api.list() })
  },
  generate: async (framework, title, context) => {
    set({ generating: true })
    try {
      const artifact = await api.generate({ framework, title, context })
      set({ items: [artifact, ...get().items], current: artifact })
    } finally {
      set({ generating: false })
    }
  },
  select: (id) => {
    const found = get().items.find((a) => a.id === id)
    if (found) set({ current: found })
  },
  remove: async (id) => {
    await api.remove(id)
    set({
      items: get().items.filter((a) => a.id !== id),
      current: get().current?.id === id ? null : get().current,
    })
  },
}))
