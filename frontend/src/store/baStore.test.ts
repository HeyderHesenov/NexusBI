import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BAArtifact } from '../types'

vi.mock('../api/ba', () => ({
  generate: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
}))

import * as api from '../api/ba'
import { useBAStore } from './baStore'

const art = (id: string, framework: BAArtifact['framework'] = 'swot'): BAArtifact => ({
  id,
  framework,
  title: `A${id}`,
  context: '',
  content: {},
  created_at: '2026-07-02T10:00:00Z',
})

beforeEach(() => {
  useBAStore.setState({ items: [], current: null, generating: false })
  vi.clearAllMocks()
})

describe('baStore', () => {
  it('generate prepends the artifact and makes it current', async () => {
    vi.mocked(api.generate).mockResolvedValue(art('1'))
    await useBAStore.getState().generate('swot', 'T', 'ctx')
    const s = useBAStore.getState()
    expect(s.items.map((a) => a.id)).toEqual(['1'])
    expect(s.current?.id).toBe('1')
    expect(s.generating).toBe(false)
  })

  it('generate clears the generating flag even on failure', async () => {
    vi.mocked(api.generate).mockRejectedValue(new Error('boom'))
    await expect(useBAStore.getState().generate('bcg', '', '')).rejects.toThrow('boom')
    expect(useBAStore.getState().generating).toBe(false)
  })

  it('select switches current to a listed artifact', () => {
    useBAStore.setState({ items: [art('1'), art('2')], current: null })
    useBAStore.getState().select('2')
    expect(useBAStore.getState().current?.id).toBe('2')
  })

  it('remove drops the item and resets current only if it was removed', async () => {
    vi.mocked(api.remove).mockResolvedValue()
    useBAStore.setState({ items: [art('1'), art('2')], current: art('1') })
    await useBAStore.getState().remove('2')
    expect(useBAStore.getState().current?.id).toBe('1')
    await useBAStore.getState().remove('1')
    const s = useBAStore.getState()
    expect(s.items).toEqual([])
    expect(s.current).toBeNull()
  })
})
