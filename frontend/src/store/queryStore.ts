import { create } from 'zustand'
import type { QueryHistoryItem, QueryResult } from '../types'
import * as queryApi from '../api/query'
import { SQL_LABEL_PREFIX } from '../lib/sqlLabel'

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
  // Power-user path: run analyst-authored SQL. Resolves to an error (shown inline
  // by the editor) or null on success — it never sets the global error card, so
  // the NL "retry" flow stays independent of manual SQL.
  runSql: (sql: string, label?: string) => Promise<QueryError | null>
  retry: () => Promise<void>
  newChat: () => void
  loadHistory: () => Promise<void>
  deleteHistoryItem: (id: string) => Promise<void>
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
  runSql: async (sql, label) => {
    // No global `loading` toggle: the SQL editor owns its own running state, so a
    // manual run must not trigger the page-level NL loading skeleton or disable
    // the natural-language input.
    try {
      const result = await queryApi.runSql(sql, get().datasourceId, label ?? null)
      const q = `${SQL_LABEL_PREFIX} ${label ?? 'SQL'}`
      set((s) => ({ result, thread: [...s.thread, { q, result }] }))
      await get().loadHistory()
      return null
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; detail?: string; sql?: string } } }
      const data = e.response?.data
      return {
        message: data?.message ?? 'SQL icra olunmadı.',
        sql: data?.sql ?? null,
        detail: data?.detail ?? null,
      }
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
  deleteHistoryItem: async (id) => {
    await queryApi.deleteQuery(id)
    // Optimistic removal for snappy UX; reload refills from the next page so the
    // capped list doesn't silently shrink below its limit.
    set((s) => ({
      history: s.history.filter((h) => h.id !== id),
      thread: s.thread.filter((t) => t.result.query_log_id !== id),
    }))
    await get().loadHistory()
  },
}))
