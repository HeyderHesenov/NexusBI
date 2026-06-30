import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('../api/dataContract', () => ({ list: vi.fn(), create: vi.fn(), run: vi.fn(), runs: vi.fn(), remove: vi.fn() }))

import { useDataContractStore } from './dataContractStore'
import * as api from '../api/dataContract'

const c = (id: string, status = 'unknown') => ({ id, name: 't', last_status: status }) as never

beforeEach(() => {
  vi.clearAllMocks()
  useDataContractStore.setState({ items: [c('c1')], runsById: {} })
})

describe('dataContractStore', () => {
  it('run updates status and loads its runs', async () => {
    vi.mocked(api.run).mockResolvedValue(c('c1', 'fail'))
    vi.mocked(api.runs).mockResolvedValue([{ id: 'r1', status: 'fail', results: [] }] as never)
    await useDataContractStore.getState().run('c1')
    expect(useDataContractStore.getState().items[0].last_status).toBe('fail')
    expect(useDataContractStore.getState().runsById['c1'][0].status).toBe('fail')
  })

  it('remove filters the contract out', async () => {
    vi.mocked(api.remove).mockResolvedValue(undefined as never)
    await useDataContractStore.getState().remove('c1')
    expect(useDataContractStore.getState().items).toEqual([])
  })
})
