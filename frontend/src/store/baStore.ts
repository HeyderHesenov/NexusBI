import { create } from 'zustand'
import type { BAArtifact, BAFramework } from '../types'
import * as api from '../api/ba'

interface BAState {
  items: BAArtifact[]
  /** The artifact currently shown on the canvas (freshly generated or picked from the list). */
  current: BAArtifact | null
  generating: boolean
  load: () => Promise<void>
  /** `datasourceId` is last + optional so existing 3-arg callers keep working. */
  generate: (
    framework: BAFramework,
    title: string,
    context: string,
    datasourceId?: string | null,
  ) => Promise<void>
  select: (id: string) => void
  remove: (id: string) => Promise<void>
  /** Promote an action to a decision; returns the decision id for the toast/link. */
  promote: (artifactId: string, actionIndex: number) => Promise<string>
}

export const useBAStore = create<BAState>((set, get) => ({
  items: [],
  current: null,
  generating: false,
  load: async () => {
    set({ items: await api.list() })
  },
  generate: async (framework, title, context, datasourceId) => {
    set({ generating: true })
    try {
      const artifact = await api.generate({
        framework,
        title,
        context,
        datasource_id: datasourceId ?? null,
      })
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
  promote: async (artifactId, actionIndex) => {
    const { decision, artifact } = await api.promote(artifactId, actionIndex)
    // Swap in the SERVER's artifact rather than patching decision_id locally —
    // promotion is idempotent server-side, so its copy is the source of truth.
    set({
      items: get().items.map((a) => (a.id === artifact.id ? artifact : a)),
      current: get().current?.id === artifact.id ? artifact : get().current,
    })
    return decision.id
  },
}))
