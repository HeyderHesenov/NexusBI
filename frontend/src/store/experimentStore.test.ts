import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../api/experiment', () => ({ list: vi.fn(), create: vi.fn(), analyze: vi.fn(), remove: vi.fn() }))

import { useExperimentStore } from './experimentStore'
import * as api from '../api/experiment'

const exp = (id: string, result: unknown = null) => ({ id, name: 't', result }) as never

beforeEach(() => {
  vi.clearAllMocks()
  useExperimentStore.setState({ items: [exp('e1')] })
})

describe('experimentStore', () => {
  it('analyze replaces the item with the analyzed version', async () => {
    vi.mocked(api.analyze).mockResolvedValue(exp('e1', { significant: true, winner: 'B' }))
    await useExperimentStore.getState().analyze('e1')
    expect(useExperimentStore.getState().items[0].result).toEqual({ significant: true, winner: 'B' })
  })

  it('add prepends and remove filters', async () => {
    vi.mocked(api.create).mockResolvedValue(exp('e2'))
    await useExperimentStore.getState().add({ name: 'x', kind: 'conversion', data: {} })
    expect(useExperimentStore.getState().items[0].id).toBe('e2')
    vi.mocked(api.remove).mockResolvedValue(undefined as never)
    await useExperimentStore.getState().remove('e2')
    expect(useExperimentStore.getState().items.find((e) => e.id === 'e2')).toBeUndefined()
  })
})
