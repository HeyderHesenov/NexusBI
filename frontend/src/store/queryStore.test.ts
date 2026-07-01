import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/query', () => ({
  askQuery: vi.fn(),
  runSql: vi.fn(),
  getHistory: vi.fn(),
  deleteQuery: vi.fn(),
}))

import { useQueryStore } from './queryStore'
import * as queryApi from '../api/query'

const askQuery = vi.mocked(queryApi.askQuery)
const runSql = vi.mocked(queryApi.runSql)
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

describe('queryStore.runSql', () => {
  it('appends a ✎-labelled turn on success and returns null (no global error)', async () => {
    runSql.mockResolvedValue({ query_log_id: 'r1', sql: 'SELECT 1' } as never)
    getHistory.mockResolvedValue({ items: [] } as never)
    useQueryStore.setState({ datasourceId: 'ds1', thread: [], error: null })

    const err = await useQueryStore.getState().runSql('SELECT 1', 'baxış')

    expect(err).toBeNull()
    expect(runSql).toHaveBeenCalledWith('SELECT 1', 'ds1', 'baxış')
    const s = useQueryStore.getState()
    expect(s.thread).toHaveLength(1)
    expect(s.thread[0].q).toBe('✎ baxış')
    expect(s.error).toBeNull() // manual SQL never touches the NL error card
    expect(s.loading).toBe(false)
  })

  it('uses a generic ✎ SQL label when none is given', async () => {
    runSql.mockResolvedValue({ query_log_id: 'r2' } as never)
    getHistory.mockResolvedValue({ items: [] } as never)
    useQueryStore.setState({ thread: [], datasourceId: null })

    await useQueryStore.getState().runSql('SELECT 2')
    expect(useQueryStore.getState().thread[0].q).toBe('✎ SQL')
  })

  it('returns the structured error inline and does not append a turn', async () => {
    runSql.mockRejectedValue({ response: { data: { message: 'Pis SQL', detail: 'd' } } })
    useQueryStore.setState({ thread: [], error: null })

    const err = await useQueryStore.getState().runSql('DROP TABLE x')

    expect(err).toEqual({ message: 'Pis SQL', sql: null, detail: 'd' })
    const s = useQueryStore.getState()
    expect(s.thread).toHaveLength(0)
    expect(s.error).toBeNull() // stays out of the global error state
    expect(s.loading).toBe(false)
  })
})
