import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../api/aiQuality', () => ({
  runEval: vi.fn(),
  listRuns: vi.fn(),
  observability: vi.fn(),
  reindex: vi.fn(),
}))

import { useAIQualityStore } from './aiQualityStore'
import * as api from '../api/aiQuality'

const runEval = vi.mocked(api.runEval)

const run = (id: string) =>
  ({ id, model: 'm', total: 5, passed: 4, exec_accuracy: 0.8, avg_latency_ms: 10, notes: '', created_at: '' }) as never

beforeEach(() => {
  vi.clearAllMocks()
  useAIQualityStore.setState({ runs: [run('old')], obs: null, busy: false })
})

describe('aiQualityStore.runEval', () => {
  it('prepends the new run and clears busy', async () => {
    runEval.mockResolvedValue(run('new'))
    await useAIQualityStore.getState().runEval()
    const s = useAIQualityStore.getState()
    expect(s.runs[0].id).toBe('new')
    expect(s.runs).toHaveLength(2)
    expect(s.busy).toBe(false)
  })
})
