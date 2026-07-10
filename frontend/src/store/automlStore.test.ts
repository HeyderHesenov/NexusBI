import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MLModelInfo } from '../types'

vi.mock('../api/automl', () => ({
  tables: vi.fn(),
  train: vi.fn(),
  listModels: vi.fn(),
  predict: vi.fn(),
  removeModel: vi.fn(),
}))

import * as api from '../api/automl'
import { useAutoMLStore } from './automlStore'

const model = (id: string): MLModelInfo => ({
  id,
  name: `M${id}`,
  source_table: 'sales',
  datasource_id: null,
  target_column: 'revenue',
  feature_columns: ['quantity'],
  problem_type: 'regression',
  best_algo: 'random_forest',
  metrics: { r2: 0.95 },
  importances: [{ feature: 'quantity', weight: 1 }],
  leaderboard: [{ algo: 'random_forest', metric: 'r2', score: 0.95, is_best: true }],
  diagnostics: { cv: { metric: 'r2', folds: 5, scores: [0.9], mean: 0.95, std: 0.01 } },
  sklearn_version: '1.6.1',
  row_count: 300,
  created_at: '2026-07-03T10:00:00Z',
})

beforeEach(() => {
  useAutoMLStore.setState({
    tables: [], models: [], training: false,
    sourceTable: null, targetColumn: null, current: null,
    predictions: null, explanations: [],
  })
  vi.clearAllMocks()
})

describe('automlStore', () => {
  it('pickSource resets stale target/predictions', () => {
    useAutoMLStore.setState({ targetColumn: 'old', predictions: [1] })
    useAutoMLStore.getState().pickSource('sales')
    const s = useAutoMLStore.getState()
    expect(s.sourceTable).toBe('sales')
    expect(s.targetColumn).toBeNull()
    expect(s.predictions).toBeNull()
  })

  it('train prepends the model, selects it, clears the training flag', async () => {
    vi.mocked(api.train).mockResolvedValue(model('1'))
    useAutoMLStore.setState({ sourceTable: 'sales', targetColumn: 'revenue' })
    await useAutoMLStore.getState().train('')
    const s = useAutoMLStore.getState()
    expect(s.training).toBe(false)
    expect(s.current?.id).toBe('1')
    expect(s.models.map((m) => m.id)).toEqual(['1'])
  })

  it('train failure clears the training flag and keeps the wizard usable', async () => {
    vi.mocked(api.train).mockRejectedValue(new Error('429'))
    useAutoMLStore.setState({ sourceTable: 'sales', targetColumn: 'revenue' })
    await expect(useAutoMLStore.getState().train('x')).rejects.toThrow('429')
    const s = useAutoMLStore.getState()
    expect(s.training).toBe(false)
    expect(s.sourceTable).toBe('sales')
    expect(s.targetColumn).toBe('revenue')
  })

  it('select switches current and drops previous predictions', () => {
    useAutoMLStore.setState({ models: [model('1'), model('2')], predictions: [9] })
    useAutoMLStore.getState().select('2')
    expect(useAutoMLStore.getState().current?.id).toBe('2')
    expect(useAutoMLStore.getState().predictions).toBeNull()
  })

  it('predict stores predictions and their per-prediction explanations', async () => {
    vi.mocked(api.predict).mockResolvedValue({
      predictions: [42],
      explanations: [[{ feature: 'quantity', value: 5, influence: 1 }]],
    })
    useAutoMLStore.setState({ current: model('1') })
    await useAutoMLStore.getState().predict([{ quantity: 5 }])
    const s = useAutoMLStore.getState()
    expect(s.predictions).toEqual([42])
    expect(s.explanations[0][0].feature).toBe('quantity')
  })

  it('select also drops stale explanations', () => {
    useAutoMLStore.setState({
      models: [model('1'), model('2')],
      explanations: [[{ feature: 'quantity', value: 1, influence: 1 }]],
    })
    useAutoMLStore.getState().select('2')
    expect(useAutoMLStore.getState().explanations).toEqual([])
  })

  it('remove clears current/predictions only when the current model is removed', async () => {
    vi.mocked(api.removeModel).mockResolvedValue()
    useAutoMLStore.setState({
      models: [model('1'), model('2')], current: model('1'), predictions: [5],
    })
    await useAutoMLStore.getState().remove('2')
    expect(useAutoMLStore.getState().current?.id).toBe('1')
    expect(useAutoMLStore.getState().predictions).toEqual([5])
    await useAutoMLStore.getState().remove('1')
    const s = useAutoMLStore.getState()
    expect(s.current).toBeNull()
    expect(s.predictions).toBeNull()
    expect(s.models).toEqual([])
  })
})
