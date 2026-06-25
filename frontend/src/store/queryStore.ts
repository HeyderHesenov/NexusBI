import { create } from 'zustand'
import type { QueryHistoryItem, QueryResult } from '../types'
import * as queryApi from '../api/query'

export interface QueryError {
  message: string
  sql?: string | null
  detail?: string | null
}

export interface ChatTurn {
  q: string
  result: QueryResult
}

interface QueryState {
  result: QueryResult | null
  thread: ChatTurn[]
  loading: boolean
  error: QueryError | null
  lastQuery: string | null
  history: QueryHistoryItem[]
  datasourceId: string | null
  setDatasource: (id: string | null) => void
  ask: (nlQuery: string) => Promise<void>
  retry: () => Promise<void>
  newChat: () => void
  loadHistory: () => Promise<void>
}

export const useQueryStore = create<QueryState>((set, get) => ({
  result: null,
  thread: [],
  loading: false,
  error: null,
  lastQuery: null,
  history: [],
  datasourceId: null,
  setDatasource: (id) => set({ datasourceId: id }),
  newChat: () => set({ thread: [], result: null, error: null, lastQuery: null }),
  ask: async (nlQuery) => {
    set({ loading: true, error: null, lastQuery: nlQuery })
    try {
      // Thread the previous turn so follow-ups resolve in context.
      const t = get().thread
      const prev = t.length ? t[t.length - 1].result.query_log_id : null
      const result = await queryApi.askQuery(nlQuery, get().datasourceId, prev)
      set((s) => ({ result, thread: [...s.thread, { q: nlQuery, result }] }))
      await get().loadHistory()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; detail?: string; sql?: string } } }
      const data = e.response?.data
      set({
        error: {
          message: data?.message ?? 'Sorğu alınmadı.',
          sql: data?.sql ?? null,
          detail: data?.detail ?? null,
        },
      })
    } finally {
      set({ loading: false })
    }
  },
  retry: async () => {
    const q = get().lastQuery
    if (q) await get().ask(q)
  },
  loadHistory: async () => {
    const page = await queryApi.getHistory(1, 20)
    set({ history: page.items })
  },
}))
