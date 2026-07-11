import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock('../api/datasource', () => ({
  replaceData: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  upload: vi.fn(),
  connectPowerBI: vi.fn(),
  getSchema: vi.fn(),
  test: vi.fn(),
  setSla: vi.fn(),
  remove: vi.fn(),
}))

import { useDatasourceStore } from './datasourceStore'
import * as api from '../api/datasource'

const ds = (id: string, name = 'S') =>
  ({ id, name, db_type: 'sqlite', created_at: '' }) as never

beforeEach(() => {
  vi.clearAllMocks()
  useDatasourceStore.setState({
    sources: [ds('d1', 'Old')],
    schemas: { d1: { sales: [] } } as never,
    loading: false,
  })
})

describe('datasourceStore.replaceData', () => {
  it('swaps the row in place (same id) and drops the stale cached schema', async () => {
    vi.mocked(api.replaceData).mockResolvedValue({
      datasource: ds('d1', 'New'),
      rows: 5,
      warnings: [],
    } as never)

    const res = await useDatasourceStore
      .getState()
      .replaceData('d1', new File(['x'], 'x.csv'))

    expect(res.rows).toBe(5)
    const { sources, schemas } = useDatasourceStore.getState()
    expect(sources).toHaveLength(1)
    expect(sources[0].id).toBe('d1') // SAME row — not orphaned
    expect(sources[0].name).toBe('New') // refreshed
    expect(schemas.d1).toBeUndefined() // stale schema evicted
  })
})
