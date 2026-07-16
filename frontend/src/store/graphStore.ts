import { create } from 'zustand'
import type { GraphData, GraphNode, GraphView } from '../types'
import * as api from '../api/graph'
import {
  loadFullGraphHidden,
  saveFullGraphHidden,
  type FullGraphHidden,
} from '../components/graph/graphView'

/** Which way impact flows from the selected node. */
export type ImpactDir = 'down' | 'up' | 'both'

interface GraphState {
  data: GraphData | null
  loading: boolean
  error: boolean
  selectedId: string | null
  impactMode: boolean
  impactDir: ImpactDir
  pathMode: boolean
  pathSource: string | null
  pathTarget: string | null
  // Saved views (curation overlays). activeViewId null = the full graph, whose
  // hidden set lives locally (no backend record) in fullHidden.
  views: GraphView[]
  activeViewId: string | null
  fullHidden: FullGraphHidden
  load: () => Promise<void>
  select: (id: string | null) => void
  toggleImpact: () => void
  setImpactDir: (dir: ImpactDir) => void
  togglePathMode: () => void
  pickPathNode: (id: string) => void
  clearPath: () => void
  loadViews: () => Promise<void>
  setActiveView: (id: string | null) => void
  createView: (name: string, includedIds?: string[] | null) => Promise<GraphView>
  renameView: (id: string, name: string) => Promise<void>
  deleteView: (id: string) => Promise<void>
  removeNode: (nodeId: string) => Promise<void>
  removeEdge: (source: string, target: string, kind: string) => Promise<void>
  addAssets: (ids: string[]) => Promise<void>
  showAll: () => Promise<void>
}

export const useGraphStore = create<GraphState>((set, get) => ({
  data: null,
  loading: false,
  error: false,
  selectedId: null,
  impactMode: false,
  impactDir: 'down',
  pathMode: false,
  pathSource: null,
  pathTarget: null,
  views: [],
  activeViewId: null,
  fullHidden: loadFullGraphHidden(),
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
  // Impact and path are mutually exclusive highlight modes — enabling one clears
  // the other so the canvas never mixes two dimming rules.
  toggleImpact: () =>
    set((s) =>
      s.impactMode
        ? { impactMode: false }
        : { impactMode: true, pathMode: false, pathSource: null, pathTarget: null },
    ),
  setImpactDir: (dir) => set({ impactDir: dir }),
  togglePathMode: () =>
    set((s) =>
      s.pathMode
        ? { pathMode: false, pathSource: null, pathTarget: null }
        : { pathMode: true, impactMode: false },
    ),
  // First pick (or a pick after a complete pair) starts a new source; the next
  // pick sets the target. Re-picking the source is a no-op.
  pickPathNode: (id) =>
    set((s) => {
      if (!s.pathSource || s.pathTarget) return { pathSource: id, pathTarget: null, selectedId: id }
      if (id === s.pathSource) return { selectedId: id }
      return { pathTarget: id, selectedId: id }
    }),
  clearPath: () => set({ pathSource: null, pathTarget: null }),

  loadViews: async () => {
    try {
      set({ views: await api.listViews() })
    } catch {
      /* interceptor toast; keep whatever views we already have */
    }
  },
  // Switching views clears the selection so the aside never describes a node the
  // new view filters out.
  setActiveView: (id) => set({ activeViewId: id, selectedId: null }),
  createView: async (name, includedIds = null) => {
    const view = await api.createView({ name, included_node_ids: includedIds })
    set((s) => ({ views: [...s.views, view], activeViewId: view.id, selectedId: null }))
    return view
  },
  renameView: async (id, name) => {
    const updated = await api.updateView(id, { name })
    set((s) => ({ views: s.views.map((v) => (v.id === updated.id ? updated : v)) }))
  },
  deleteView: async (id) => {
    await api.deleteView(id)
    set((s) => ({
      views: s.views.filter((v) => v.id !== id),
      activeViewId: s.activeViewId === id ? null : s.activeViewId,
      selectedId: s.activeViewId === id ? null : s.selectedId,
    }))
  },
  // Remove-from-view: append to the active view's hidden set (persisted PATCH),
  // or the full graph's local hidden set. Optimistic; a failed PATCH resyncs.
  removeNode: async (nodeId) => {
    const { activeViewId, views, fullHidden, selectedId } = get()
    // A removed node leaves the canvas — drop it from the selection so the aside
    // (and impact/path modes) don't describe an off-canvas node.
    if (selectedId === nodeId) set({ selectedId: null })
    if (activeViewId) {
      const view = views.find((v) => v.id === activeViewId)
      if (!view || view.hidden_node_ids.includes(nodeId)) return
      const hidden_node_ids = [...view.hidden_node_ids, nodeId]
      set({ views: views.map((v) => (v.id === activeViewId ? { ...v, hidden_node_ids } : v)) })
      try {
        const updated = await api.updateView(activeViewId, { hidden_node_ids })
        set((s) => ({ views: s.views.map((v) => (v.id === updated.id ? updated : v)) }))
      } catch {
        void get().loadViews()
      }
    } else {
      if (fullHidden.nodes.includes(nodeId)) return
      const next = { ...fullHidden, nodes: [...fullHidden.nodes, nodeId] }
      set({ fullHidden: next })
      saveFullGraphHidden(next)
    }
  },
  removeEdge: async (source, target, kind) => {
    const key = edgeViewKey(source, target, kind)
    const { activeViewId, views, fullHidden } = get()
    if (activeViewId) {
      const view = views.find((v) => v.id === activeViewId)
      if (!view || view.hidden_edge_keys.includes(key)) return
      const hidden_edge_keys = [...view.hidden_edge_keys, key]
      set({ views: views.map((v) => (v.id === activeViewId ? { ...v, hidden_edge_keys } : v)) })
      try {
        const updated = await api.updateView(activeViewId, { hidden_edge_keys })
        set((s) => ({ views: s.views.map((v) => (v.id === updated.id ? updated : v)) }))
      } catch {
        void get().loadViews()
      }
    } else {
      if (fullHidden.edges.includes(key)) return
      const next = { ...fullHidden, edges: [...fullHidden.edges, key] }
      set({ fullHidden: next })
      saveFullGraphHidden(next)
    }
  },
  // Add existing assets to the active (curated) view — union onto its included set.
  addAssets: async (ids) => {
    const { activeViewId, views } = get()
    if (!activeViewId || ids.length === 0) return
    const view = views.find((v) => v.id === activeViewId)
    if (!view) return
    const included_node_ids = [...new Set([...(view.included_node_ids ?? []), ...ids])]
    const updated = await api.updateView(activeViewId, { included_node_ids })
    set((s) => ({ views: s.views.map((v) => (v.id === updated.id ? updated : v)) }))
  },
  // Restore everything hidden in the active view (or the full graph locally).
  showAll: async () => {
    const { activeViewId, views } = get()
    if (activeViewId) {
      const view = views.find((v) => v.id === activeViewId)
      if (!view) return
      const updated = await api.updateView(activeViewId, {
        hidden_node_ids: [],
        hidden_edge_keys: [],
      })
      set((s) => ({ views: s.views.map((v) => (v.id === updated.id ? updated : v)) }))
    } else {
      const cleared: FullGraphHidden = { nodes: [], edges: [] }
      set({ fullHidden: cleared })
      saveFullGraphHidden(cleared)
    }
  },
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

/** Upstream reachability against edge direction (what feeds this node), self included. */
export function upstreamSet(data: GraphData, startId: string): Set<string> {
  const adj = new Map<string, string[]>()
  for (const e of data.edges) {
    const list = adj.get(e.target)
    if (list) list.push(e.source)
    else adj.set(e.target, [e.source])
  }
  const seen = new Set<string>([startId])
  const queue = [startId]
  while (queue.length) {
    const cur = queue.shift()!
    for (const prev of adj.get(cur) ?? []) {
      if (!seen.has(prev)) {
        seen.add(prev)
        queue.push(prev)
      }
    }
  }
  return seen
}

/** Order-independent key for an undirected edge, so a path edge matches either
 *  direction it's drawn in. */
export function pathEdgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * Shortest undirected path between two nodes (BFS): the ordered node list plus a
 * Set of canonical edge keys. Returns null when the nodes are disconnected.
 */
export function pathBetween(
  data: GraphData,
  a: string,
  b: string,
): { nodes: string[]; edges: Set<string> } | null {
  if (a === b) return { nodes: [a], edges: new Set() }
  const adj = new Map<string, string[]>()
  const add = (u: string, v: string) => {
    const list = adj.get(u)
    if (list) list.push(v)
    else adj.set(u, [v])
  }
  for (const e of data.edges) {
    add(e.source, e.target)
    add(e.target, e.source)
  }
  const parent = new Map<string, string>()
  const seen = new Set<string>([a])
  const queue = [a]
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === b) break
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        parent.set(next, cur)
        queue.push(next)
      }
    }
  }
  if (!seen.has(b)) return null
  const nodes: string[] = [b]
  let cur = b
  while (cur !== a) {
    const p = parent.get(cur)!
    nodes.push(p)
    cur = p
  }
  nodes.reverse()
  const edges = new Set<string>()
  for (let i = 0; i < nodes.length - 1; i++) edges.add(pathEdgeKey(nodes[i], nodes[i + 1]))
  return { nodes, edges }
}

/** Undirected direct neighbors of a node (both edge directions), self included. */
export function neighborSet(data: GraphData, id: string): Set<string> {
  const set = new Set<string>([id])
  for (const e of data.edges) {
    if (e.source === id) set.add(e.target)
    else if (e.target === id) set.add(e.source)
  }
  return set
}

export function selectedNode(data: GraphData | null, id: string | null): GraphNode | null {
  if (!data || !id) return null
  return data.nodes.find((n) => n.id === id) ?? null
}

// --- Saved views: pure filter over the single derived graph -----------------

/** Directed key for an edge INCLUDING its kind — so hiding one edge never also
 *  drops a reverse or parallel edge of a different kind. (Distinct from the
 *  order-independent, kind-less `pathEdgeKey`, which is only for path highlight.) */
export function edgeViewKey(source: string, target: string, kind: string): string {
  return `${source} ${target} ${kind}`
}

/** Resolved filter for the active view. `included === null` ⇒ the full graph. */
export interface ViewConfig {
  included: string[] | null
  hiddenNodes: string[]
  hiddenEdges: string[]
}

/**
 * Derive a view's subgraph from the full derived graph + a config: keep the
 * included nodes (or all when null) minus hidden nodes, then keep every edge
 * whose endpoints both survive and whose directed key isn't hidden. Returns the
 * input reference unchanged when config is null (referential stability = no
 * needless re-layout on the full graph).
 */
export function viewGraph(data: GraphData, config: ViewConfig | null): GraphData {
  if (!config) return data
  const included = config.included ? new Set(config.included) : null
  const hiddenNodes = new Set(config.hiddenNodes)
  const hiddenEdges = new Set(config.hiddenEdges)
  const nodes = data.nodes.filter(
    (n) => (!included || included.has(n.id)) && !hiddenNodes.has(n.id),
  )
  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges = data.edges.filter(
    (e) =>
      nodeIds.has(e.source) &&
      nodeIds.has(e.target) &&
      !hiddenEdges.has(edgeViewKey(e.source, e.target, e.kind)),
  )
  return { nodes, edges }
}

/** Build the active view's config from store state, or null when the full graph
 *  is active with nothing locally hidden (so `viewGraph` short-circuits). */
export function activeViewConfig(s: {
  views: GraphView[]
  activeViewId: string | null
  fullHidden: FullGraphHidden
}): ViewConfig | null {
  if (s.activeViewId) {
    const v = s.views.find((x) => x.id === s.activeViewId)
    if (!v) return null // stale id (view deleted elsewhere) → fall back to full
    return {
      included: v.included_node_ids,
      hiddenNodes: v.hidden_node_ids,
      hiddenEdges: v.hidden_edge_keys,
    }
  }
  if (s.fullHidden.nodes.length === 0 && s.fullHidden.edges.length === 0) return null
  return { included: null, hiddenNodes: s.fullHidden.nodes, hiddenEdges: s.fullHidden.edges }
}
