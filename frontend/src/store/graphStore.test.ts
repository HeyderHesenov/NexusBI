import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/graph', () => ({
  getGraph: vi.fn(),
  listViews: vi.fn(),
  createView: vi.fn(),
  updateView: vi.fn(),
  deleteView: vi.fn(),
}))

import {
  activeViewConfig,
  edgeViewKey,
  impactSet,
  neighborSet,
  pathBetween,
  pathEdgeKey,
  selectedNode,
  upstreamSet,
  useGraphStore,
  viewGraph,
} from './graphStore'
import * as api from '../api/graph'
import type { GraphData, GraphView } from '../types'

// ds → table → widget → dash, metric → widget, mnode child → parent
const FIXTURE: GraphData = {
  nodes: [
    { id: 'ds:demo', type: 'ds', label: 'Demo', ref_id: null },
    { id: 'table:sales', type: 'table', label: 'sales', ref_id: null },
    { id: 'widget:w1', type: 'widget', label: 'W1', ref_id: 'w1' },
    { id: 'dash:d1', type: 'dash', label: 'D1', ref_id: 'd1' },
    { id: 'metric:m1', type: 'metric', label: 'gəlir', ref_id: 'm1' },
    { id: 'mnode:c', type: 'mnode', label: 'child', ref_id: 'c' },
    { id: 'mnode:p', type: 'mnode', label: 'parent', ref_id: 'p' },
  ],
  edges: [
    { source: 'ds:demo', target: 'table:sales', kind: 'hosts' },
    { source: 'table:sales', target: 'widget:w1', kind: 'feeds' },
    { source: 'widget:w1', target: 'dash:d1', kind: 'contains' },
    { source: 'metric:m1', target: 'widget:w1', kind: 'informs' },
    { source: 'mnode:c', target: 'mnode:p', kind: 'rolls_up' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useGraphStore.setState({
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
    fullHidden: { nodes: [], edges: [] },
  })
})

const VIEW: GraphView = {
  id: 'v1',
  name: 'My view',
  included_node_ids: ['ds:demo', 'table:sales'],
  hidden_node_ids: [],
  hidden_edge_keys: [],
  created_at: '2026-07-16T00:00:00Z',
  updated_at: '2026-07-16T00:00:00Z',
}

describe('impactSet (downstream BFS)', () => {
  it('reaches everything downstream of a table', () => {
    expect(impactSet(FIXTURE, 'table:sales')).toEqual(
      new Set(['table:sales', 'widget:w1', 'dash:d1']),
    )
  })

  it('does not travel upstream', () => {
    const set = impactSet(FIXTURE, 'widget:w1')
    expect(set.has('table:sales')).toBe(false)
    expect(set.has('metric:m1')).toBe(false)
    expect(set).toEqual(new Set(['widget:w1', 'dash:d1']))
  })

  it('KPI child impacts its parent (roll-up), not vice versa', () => {
    expect(impactSet(FIXTURE, 'mnode:c')).toEqual(new Set(['mnode:c', 'mnode:p']))
    expect(impactSet(FIXTURE, 'mnode:p')).toEqual(new Set(['mnode:p']))
  })

  it('a leaf node impacts only itself', () => {
    expect(impactSet(FIXTURE, 'dash:d1')).toEqual(new Set(['dash:d1']))
  })
})

describe('upstreamSet (reverse BFS)', () => {
  it('reaches everything that feeds a widget', () => {
    expect(upstreamSet(FIXTURE, 'widget:w1')).toEqual(
      new Set(['widget:w1', 'table:sales', 'metric:m1', 'ds:demo']),
    )
  })

  it('does not travel downstream', () => {
    expect(upstreamSet(FIXTURE, 'widget:w1').has('dash:d1')).toBe(false)
  })

  it('a root source has only itself upstream', () => {
    expect(upstreamSet(FIXTURE, 'ds:demo')).toEqual(new Set(['ds:demo']))
  })
})

describe('pathEdgeKey', () => {
  it('is order-independent', () => {
    expect(pathEdgeKey('a', 'b')).toBe(pathEdgeKey('b', 'a'))
  })
})

describe('pathBetween (undirected BFS)', () => {
  it('finds the ordered path and its canonical edge keys', () => {
    const p = pathBetween(FIXTURE, 'metric:m1', 'dash:d1')
    expect(p?.nodes).toEqual(['metric:m1', 'widget:w1', 'dash:d1'])
    expect(p?.edges).toEqual(
      new Set([pathEdgeKey('metric:m1', 'widget:w1'), pathEdgeKey('widget:w1', 'dash:d1')]),
    )
  })

  it('is symmetric in its endpoints', () => {
    const ab = pathBetween(FIXTURE, 'metric:m1', 'dash:d1')
    const ba = pathBetween(FIXTURE, 'dash:d1', 'metric:m1')
    expect(ab?.edges).toEqual(ba?.edges)
  })

  it('returns null when the nodes are disconnected', () => {
    // the KPI tree (mnode:c/p) is a separate component from the ds→dash chain
    expect(pathBetween(FIXTURE, 'metric:m1', 'mnode:p')).toBeNull()
  })

  it('a node to itself is a single-node path with no edges', () => {
    expect(pathBetween(FIXTURE, 'metric:m1', 'metric:m1')).toEqual({
      nodes: ['metric:m1'],
      edges: new Set(),
    })
  })
})

describe('path & impact store modes', () => {
  it('pickPathNode sets source, then target, then restarts', () => {
    const { pickPathNode } = useGraphStore.getState()
    useGraphStore.setState({ pathMode: true })
    pickPathNode('a')
    expect(useGraphStore.getState()).toMatchObject({ pathSource: 'a', pathTarget: null })
    pickPathNode('b')
    expect(useGraphStore.getState()).toMatchObject({ pathSource: 'a', pathTarget: 'b' })
    pickPathNode('c') // a complete pair → next pick starts fresh
    expect(useGraphStore.getState()).toMatchObject({ pathSource: 'c', pathTarget: null })
  })

  it('enabling path mode turns impact mode off', () => {
    useGraphStore.setState({ impactMode: true })
    useGraphStore.getState().togglePathMode()
    expect(useGraphStore.getState()).toMatchObject({ pathMode: true, impactMode: false })
  })

  it('enabling impact mode turns path mode off and clears picks', () => {
    useGraphStore.setState({ pathMode: true, pathSource: 'a', pathTarget: 'b' })
    useGraphStore.getState().toggleImpact()
    expect(useGraphStore.getState()).toMatchObject({
      impactMode: true,
      pathMode: false,
      pathSource: null,
      pathTarget: null,
    })
  })
})

describe('neighborSet (undirected)', () => {
  it('includes neighbors on both edge directions plus self', () => {
    // widget:w1 is fed by table:sales & metric:m1 (incoming) and contained in dash:d1 (outgoing)
    expect(neighborSet(FIXTURE, 'widget:w1')).toEqual(
      new Set(['widget:w1', 'table:sales', 'metric:m1', 'dash:d1']),
    )
  })

  it('a node with no edges is alone', () => {
    expect(neighborSet(FIXTURE, 'ghost')).toEqual(new Set(['ghost']))
  })
})

describe('graphStore', () => {
  it('load stores the graph and clears flags', async () => {
    vi.mocked(api.getGraph).mockResolvedValue(FIXTURE)
    await useGraphStore.getState().load()
    const s = useGraphStore.getState()
    expect(s.data?.nodes).toHaveLength(7)
    expect(s.loading).toBe(false)
    expect(s.error).toBe(false)
  })

  it('load failure sets the error flag', async () => {
    vi.mocked(api.getGraph).mockRejectedValue(new Error('boom'))
    await useGraphStore.getState().load()
    expect(useGraphStore.getState().error).toBe(true)
  })

  it('selectedNode resolves the node or null', () => {
    expect(selectedNode(FIXTURE, 'metric:m1')?.label).toBe('gəlir')
    expect(selectedNode(FIXTURE, 'ghost')).toBeNull()
    expect(selectedNode(null, 'metric:m1')).toBeNull()
  })
})

describe('edgeViewKey', () => {
  it('is directional and kind-specific (unlike pathEdgeKey)', () => {
    expect(edgeViewKey('a', 'b', 'feeds')).not.toBe(edgeViewKey('b', 'a', 'feeds'))
    expect(edgeViewKey('a', 'b', 'feeds')).not.toBe(edgeViewKey('a', 'b', 'hosts'))
  })
})

describe('viewGraph', () => {
  it('returns the same reference for a null config (no needless re-layout)', () => {
    expect(viewGraph(FIXTURE, null)).toBe(FIXTURE)
  })

  it('keeps only included nodes and edges among them', () => {
    const g = viewGraph(FIXTURE, {
      included: ['ds:demo', 'table:sales'],
      hiddenNodes: [],
      hiddenEdges: [],
    })
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['ds:demo', 'table:sales'])
    expect(g.edges).toEqual([{ source: 'ds:demo', target: 'table:sales', kind: 'hosts' }])
  })

  it('an added asset makes its derived edge appear', () => {
    const g = viewGraph(FIXTURE, {
      included: ['ds:demo', 'table:sales', 'widget:w1'],
      hiddenNodes: [],
      hiddenEdges: [],
    })
    const edges = g.edges.map((e) => `${e.source}>${e.target}`)
    expect(edges).toContain('table:sales>widget:w1') // feeds edge now shown
    expect(edges).not.toContain('widget:w1>dash:d1') // dash not included → dropped
  })

  it('a hidden node drops it and every incident edge', () => {
    const g = viewGraph(FIXTURE, {
      included: null,
      hiddenNodes: ['widget:w1'],
      hiddenEdges: [],
    })
    expect(g.nodes.find((n) => n.id === 'widget:w1')).toBeUndefined()
    expect(g.edges.some((e) => e.source === 'widget:w1' || e.target === 'widget:w1')).toBe(false)
  })

  it('a hidden edge drops exactly that directed edge, keeping the node', () => {
    const g = viewGraph(FIXTURE, {
      included: null,
      hiddenNodes: [],
      hiddenEdges: [edgeViewKey('table:sales', 'widget:w1', 'feeds')],
    })
    expect(g.nodes.find((n) => n.id === 'widget:w1')).toBeDefined()
    expect(g.edges.some((e) => e.source === 'table:sales' && e.target === 'widget:w1')).toBe(false)
    // Other edges into the widget survive.
    expect(g.edges.some((e) => e.source === 'metric:m1' && e.target === 'widget:w1')).toBe(true)
  })

  it('keeps an isolated included node with no edges', () => {
    const g = viewGraph(FIXTURE, { included: ['metric:m1'], hiddenNodes: [], hiddenEdges: [] })
    expect(g.nodes.map((n) => n.id)).toEqual(['metric:m1'])
    expect(g.edges).toEqual([])
  })
})

describe('activeViewConfig', () => {
  it('is null for the full graph with nothing hidden', () => {
    expect(
      activeViewConfig({ views: [], activeViewId: null, fullHidden: { nodes: [], edges: [] } }),
    ).toBeNull()
  })

  it('builds a full-graph config when something is locally hidden', () => {
    const c = activeViewConfig({
      views: [],
      activeViewId: null,
      fullHidden: { nodes: ['x'], edges: [] },
    })
    expect(c).toEqual({ included: null, hiddenNodes: ['x'], hiddenEdges: [] })
  })

  it('builds config from the active named view', () => {
    const c = activeViewConfig({ views: [VIEW], activeViewId: 'v1', fullHidden: { nodes: [], edges: [] } })
    expect(c).toEqual({
      included: ['ds:demo', 'table:sales'],
      hiddenNodes: [],
      hiddenEdges: [],
    })
  })

  it('falls back to full graph for a stale active id', () => {
    expect(
      activeViewConfig({ views: [], activeViewId: 'gone', fullHidden: { nodes: [], edges: [] } }),
    ).toBeNull()
  })
})

describe('view actions', () => {
  it('setActiveView switches view and clears the selection', () => {
    useGraphStore.setState({ selectedId: 'metric:m1' })
    useGraphStore.getState().setActiveView('v1')
    const s = useGraphStore.getState()
    expect(s.activeViewId).toBe('v1')
    expect(s.selectedId).toBeNull()
  })

  it('createView appends the view and activates it', async () => {
    vi.mocked(api.createView).mockResolvedValue(VIEW)
    await useGraphStore.getState().createView('My view', ['ds:demo', 'table:sales'])
    const s = useGraphStore.getState()
    expect(s.views).toEqual([VIEW])
    expect(s.activeViewId).toBe('v1')
  })

  it('removeNode on a named view PATCHes an appended hidden set', async () => {
    const updated = { ...VIEW, hidden_node_ids: ['table:sales'] }
    vi.mocked(api.updateView).mockResolvedValue(updated)
    useGraphStore.setState({ views: [VIEW], activeViewId: 'v1' })
    await useGraphStore.getState().removeNode('table:sales')
    expect(api.updateView).toHaveBeenCalledWith('v1', { hidden_node_ids: ['table:sales'] })
    expect(useGraphStore.getState().views[0].hidden_node_ids).toEqual(['table:sales'])
  })

  it('removeNode on the full graph writes local storage (no backend)', async () => {
    await useGraphStore.getState().removeNode('table:sales')
    expect(api.updateView).not.toHaveBeenCalled()
    expect(useGraphStore.getState().fullHidden.nodes).toContain('table:sales')
    expect(localStorage.getItem('nexusbi.graph.fullHidden.v1')).toContain('table:sales')
  })

  it('removeEdge on the full graph stores a directed edge key', async () => {
    await useGraphStore.getState().removeEdge('table:sales', 'widget:w1', 'feeds')
    expect(useGraphStore.getState().fullHidden.edges).toEqual([
      edgeViewKey('table:sales', 'widget:w1', 'feeds'),
    ])
  })

  it('addAssets unions ids onto the active view included set', async () => {
    vi.mocked(api.updateView).mockResolvedValue({
      ...VIEW,
      included_node_ids: ['ds:demo', 'table:sales', 'widget:w1'],
    })
    useGraphStore.setState({ views: [VIEW], activeViewId: 'v1' })
    await useGraphStore.getState().addAssets(['widget:w1', 'ds:demo'])
    expect(api.updateView).toHaveBeenCalledWith('v1', {
      included_node_ids: ['ds:demo', 'table:sales', 'widget:w1'],
    })
  })

  it('deleteView removes it and resets the active view', async () => {
    vi.mocked(api.deleteView).mockResolvedValue()
    useGraphStore.setState({ views: [VIEW], activeViewId: 'v1', selectedId: 'ds:demo' })
    await useGraphStore.getState().deleteView('v1')
    const s = useGraphStore.getState()
    expect(s.views).toEqual([])
    expect(s.activeViewId).toBeNull()
    expect(s.selectedId).toBeNull()
  })

  it('showAll clears the full-graph hidden set', async () => {
    useGraphStore.setState({ fullHidden: { nodes: ['x'], edges: ['y'] } })
    await useGraphStore.getState().showAll()
    expect(useGraphStore.getState().fullHidden).toEqual({ nodes: [], edges: [] })
  })
})
