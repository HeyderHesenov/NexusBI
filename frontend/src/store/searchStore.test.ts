import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/search', () => ({ searchAssets: vi.fn(), reindexSearch: vi.fn() }))

import { useSearchStore } from './searchStore'
import * as searchApi from '../api/search'

const searchAssets = vi.mocked(searchApi.searchAssets)

beforeEach(() => {
  vi.clearAllMocks()
  useSearchStore.setState({ open: false, query: '', hits: [], loading: false })
})

describe('searchStore', () => {
  it('setOpen(false) clears query and hits', () => {
    useSearchStore.setState({ open: true, query: 'x', hits: [{ kind: 'dashboard', ref_id: '1', title: 't', score: 1 }] })
    useSearchStore.getState().setOpen(false)
    const s = useSearchStore.getState()
    expect(s).toMatchObject({ open: false, query: '', hits: [] })
  })

  it('run populates hits for a matching query', async () => {
    searchAssets.mockResolvedValue([{ kind: 'metric_asset', ref_id: 'm1', title: 'Churn', score: 0.9 }])
    useSearchStore.setState({ query: 'churn' })
    await useSearchStore.getState().run('churn')
    expect(searchAssets).toHaveBeenCalledWith('churn')
    expect(useSearchStore.getState().hits[0].title).toBe('Churn')
    expect(useSearchStore.getState().loading).toBe(false)
  })

  it('run with a blank query short-circuits without calling the API', async () => {
    await useSearchStore.getState().run('   ')
    expect(searchAssets).not.toHaveBeenCalled()
    expect(useSearchStore.getState().hits).toEqual([])
  })

  it('drops a stale response when the query has moved on', async () => {
    searchAssets.mockResolvedValue([{ kind: 'dashboard', ref_id: 'd1', title: 'old', score: 0.5 }])
    useSearchStore.setState({ query: 'new-term' }) // user already typed something else
    await useSearchStore.getState().run('old-term')
    expect(useSearchStore.getState().hits).toEqual([]) // stale result ignored
  })
})
