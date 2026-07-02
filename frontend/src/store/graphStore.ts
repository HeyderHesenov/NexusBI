import { create } from 'zustand'
import type { GraphData, GraphNode } from '../types'
import * as api from '../api/graph'

interface GraphState {
  data: GraphData | null
  loading: boolean
  error: boolean
  selectedId: string | null
  impactMode: boolean
  load: () => Promise<void>
  select: (id: string | null) => void
  toggleImpact: () => void
}

export const useGraphStore = create<GraphState>((set, get) => ({
  data: null,
  loading: false,
  error: false,
  selectedId: null,
  impactMode: false,
  load: async () => {
    set({ loading: true, error: false })
    try {
      set({ data: await api.getGraph() })
    } catch {
      set({ error: true })
    } finally {
      set({ loading: false })
    }
  },
  select: (id) => set({ selectedId: id }),
  toggleImpact: () => set({ impactMode: !get().impactMode }),
}))

/** Downstream reachability along edge direction (data flow), self included. */
export function impactSet(data: GraphData, startId: string): Set<string> {
  const adj = new Map<string, string[]>()
  for (const e of data.edges) {
    const list = adj.get(e.source)
    if (list) list.push(e.target)
    else adj.set(e.source, [e.target])
  }
  const seen = new Set<string>([startId])
  const queue = [startId]
  while (queue.length) {
    const cur = queue.shift()!
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return seen
}

export function selectedNode(data: GraphData | null, id: string | null): GraphNode | null {
  if (!data || !id) return null
  return data.nodes.find((n) => n.id === id) ?? null
}
