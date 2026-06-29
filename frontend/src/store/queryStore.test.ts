import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/query', () => ({
  askQuery: vi.fn(),
  getHistory: vi.fn(),
  deleteQuery: vi.fn(),
}))

import { useQueryStore } from './queryStore'
import * as queryApi from '../api/query'

const askQuery = vi.mocked(queryApi.askQuery)
const getHistory = vi.mocked(queryApi.getHistory)
const deleteQuery = vi.mocked(queryApi.deleteQuery)

const turn = (id: string): { q: string; result: { query_log_id: string } } => ({
  q: id,
  result: { query_log_id: id },
})

beforeEach(() => {
  vi.clearAllMocks()
  useQueryStore.setState({ result: null, thread: [], error: null, lastQuery: 'x', history: [] })
})

describe('queryStore.newChat', () => {
  it('clears thread/result/error/lastQuery', () => {
    useQueryStore.setState({
      thread: [turn('a')] as never,
      result: turn('a').result as never,
      error: { message: 'e' },
      lastQuery: 'q',
    })
    useQueryStore.getState().newChat()
    const s = useQueryStore.getState()
    expect(s.thread).toEqual([])
    expect(s.result).toBeNull()
    expect(s.error).toBeNull()
    expect(s.lastQuery).toBeNull()
  })
})

describe('queryStore.ask error mapping', () => {
  it('maps a structured API error into {message, sql, detail}', async () => {
    askQuery.mockRejectedValue({ response: { data: { message: 'Yanlış', sql: 'SELECT 1', detail: 'd' } } })
    await useQueryStore.getState().ask('show sales')
    expect(useQueryStore.getState().error).toEqual({ message: 'Yanlış', sql: 'SELECT 1', detail: 'd' })
    expect(useQueryStore.getState().loading).toBe(false)
  })

  it('falls back to a default message when none is provided', async () => {
    askQuery.mockRejectedValue({})
    await useQueryStore.getState().ask('x')
    expect(useQueryStore.getState().error?.message).toBe('Sorğu alınmadı.')
  })
})

describe('queryStore.deleteHistoryItem', () => {
  it('optimistically drops the id from history and thread, then reloads', async () => {
    deleteQuery.mockResolvedValue(undefined as never)
    getHistory.mockResolvedValue({ items: [{ id: 'keep' }] } as never)
    useQueryStore.setState({
      history: [{ id: 'gone' }, { id: 'keep' }] as never,
      thread: [turn('gone'), turn('keep')] as never,
    })
    await useQueryStore.getState().deleteHistoryItem('gone')
    const s = useQueryStore.getState()
    expect(deleteQuery).toHaveBeenCalledWith('gone')
    expect(s.thread.map((t) => t.result.query_log_id)).toEqual(['keep'])
    expect(s.history).toEqual([{ id: 'keep' }]) // reloaded from server
  })
})
