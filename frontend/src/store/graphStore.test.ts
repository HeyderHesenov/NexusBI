import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/graph', () => ({ getGraph: vi.fn() }))

import { impactSet, selectedNode, useGraphStore } from './graphStore'
import * as api from '../api/graph'
import type { GraphData } from '../types'

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
  useGraphStore.setState({ data: null, loading: false, error: false, selectedId: null, impactMode: false })
})

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
