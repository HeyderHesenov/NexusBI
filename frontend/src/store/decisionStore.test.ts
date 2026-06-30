import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../api/decision', () => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  measure: vi.fn(),
  accuracy: vi.fn(),
}))

import { useDecisionStore } from './decisionStore'
import * as api from '../api/decision'

const measure = vi.mocked(api.measure)
const accuracy = vi.mocked(api.accuracy)

const decision = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id, title: id, insight: '', action: '', status: 'open', outcome: '',
    query_log_id: null, created_at: '', metric_query: null, metric_column: null,
    datasource_id: null, predicted_value: null, predicted_direction: null,
    baseline_value: 100, baseline_at: null, realized_value: null, realized_at: null,
    measure_cadence: 'off', impact_status: 'pending', ...over,
  }) as never

beforeEach(() => {
  vi.clearAllMocks()
  useDecisionStore.setState({ items: [decision('d1')], accuracy: null })
})

describe('decisionStore.measure', () => {
  it('merges the ROI into the matching item and refreshes accuracy', async () => {
    measure.mockResolvedValue({
      decision_id: 'd1', baseline_value: 100, predicted_value: 150, realized_value: 130,
      predicted_direction: 'increase', delta_abs: 30, delta_pct: 30, progress_pct: 60,
      impact_status: 'on_track', baseline_at: null, realized_at: '2026-06-30T00:00:00Z',
    } as never)
    accuracy.mockResolvedValue({
      total_measured: 1, direction_hit_rate: 100, achieved: 0,
      accuracy_pct: 100, avg_magnitude_error_pct: 13.3,
    } as never)

    await useDecisionStore.getState().measure('d1')
    const item = useDecisionStore.getState().items[0]
    expect(item.realized_value).toBe(130)
    expect(item.impact_status).toBe('on_track')
    expect(useDecisionStore.getState().accuracy?.accuracy_pct).toBe(100)
  })
})
