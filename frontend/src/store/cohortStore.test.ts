import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/cohort', () => ({ retention: vi.fn(), funnel: vi.fn() }))

import { useCohortStore } from './cohortStore'
import * as api from '../api/cohort'
import type { CohortData, FunnelStep } from '../types'

const RETENTION: CohortData = {
  cohorts: ['2024-01'],
  offsets: [0, 1],
  sizes: [5],
  cells: [[{ count: 5, pct: 100 }, { count: 4, pct: 80 }]],
}
const FUNNEL: FunnelStep[] = [
  { name: 'visit', count: 60, pct_of_first: 100, drop_pct: 0 },
  { name: 'signup', count: 45, pct_of_first: 75, drop_pct: 25 },
]

beforeEach(() => {
  vi.clearAllMocks()
  useCohortStore.setState({ retention: null, funnel: [], loading: false, error: false })
})

describe('cohortStore', () => {
  it('load fetches retention and funnel together', async () => {
    vi.mocked(api.retention).mockResolvedValue(RETENTION)
    vi.mocked(api.funnel).mockResolvedValue(FUNNEL)
    await useCohortStore.getState().load()
    const s = useCohortStore.getState()
    expect(s.retention).toEqual(RETENTION)
    expect(s.funnel).toHaveLength(2)
    expect(s.loading).toBe(false)
    expect(s.error).toBe(false)
  })

  it('load sets the error flag and clears loading on failure', async () => {
    vi.mocked(api.retention).mockRejectedValue(new Error('boom'))
    vi.mocked(api.funnel).mockResolvedValue(FUNNEL)
    await useCohortStore.getState().load()
    const s = useCohortStore.getState()
    expect(s.error).toBe(true)
    expect(s.loading).toBe(false)
    expect(s.retention).toBeNull()
  })

  it('a retry clears the previous error flag', async () => {
    useCohortStore.setState({ error: true })
    vi.mocked(api.retention).mockResolvedValue(RETENTION)
    vi.mocked(api.funnel).mockResolvedValue(FUNNEL)
    await useCohortStore.getState().load()
    expect(useCohortStore.getState().error).toBe(false)
  })
})
