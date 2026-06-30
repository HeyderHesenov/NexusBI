import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../api/metricTree', () => ({ evaluate: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }))

import { useMetricTreeStore } from './metricTreeStore'
import * as api from '../api/metricTree'

beforeEach(() => {
  vi.clearAllMocks()
  useMetricTreeStore.setState({ forest: [] })
})

describe('metricTreeStore', () => {
  it('add creates then reloads the evaluated forest', async () => {
    vi.mocked(api.create).mockResolvedValue({ id: 'n1' } as never)
    vi.mocked(api.evaluate).mockResolvedValue([{ id: 'n1', name: 'Gəlir', value: 300, children: [] }] as never)
    await useMetricTreeStore.getState().add({ name: 'Gəlir' })
    expect(api.create).toHaveBeenCalled()
    expect(useMetricTreeStore.getState().forest[0].value).toBe(300)
  })

  it('remove deletes then reloads', async () => {
    vi.mocked(api.remove).mockResolvedValue(undefined as never)
    vi.mocked(api.evaluate).mockResolvedValue([] as never)
    await useMetricTreeStore.getState().remove('n1')
    expect(api.remove).toHaveBeenCalledWith('n1')
    expect(useMetricTreeStore.getState().forest).toEqual([])
  })
})
