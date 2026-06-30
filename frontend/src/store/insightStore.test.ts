import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('../api/insight', () => ({ list: vi.fn(), generate: vi.fn(), dismiss: vi.fn() }))

import { useInsightStore } from './insightStore'
import * as api from '../api/insight'

const ins = (id: string) => ({ id, kind: 'dominance', title: 't', impact_score: 0.5 }) as never

beforeEach(() => {
  vi.clearAllMocks()
  useInsightStore.setState({ items: [ins('i1'), ins('i2')], generating: false })
})

describe('insightStore', () => {
  it('dismiss removes the item optimistically', async () => {
    vi.mocked(api.dismiss).mockResolvedValue(undefined as never)
    await useInsightStore.getState().dismiss('i1')
    expect(useInsightStore.getState().items.map((i) => i.id)).toEqual(['i2'])
    expect(api.dismiss).toHaveBeenCalledWith('i1')
  })

  it('generate reloads and is guarded against concurrent runs', async () => {
    vi.mocked(api.generate).mockResolvedValue({ created: 3 } as never)
    vi.mocked(api.list).mockResolvedValue([ins('i9')] as never)
    await useInsightStore.getState().generate()
    expect(api.generate).toHaveBeenCalledTimes(1)
    expect(useInsightStore.getState().items.map((i) => i.id)).toEqual(['i9'])
  })
})
