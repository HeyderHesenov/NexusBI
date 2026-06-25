import { create } from 'zustand'
import type { QueryHistoryItem, QueryResult } from '../types'
import * as queryApi from '../api/query'

export interface QueryError {
  message: string
  sql?: string | null
  detail?: string | null
}

interface QueryState {
  result: QueryResult | null
  loading: boolean
  error: QueryError | null
  lastQuery: string | null
  history: QueryHistoryItem[]
  datasourceId: string | null
  setDatasource: (id: string | null) => void
  ask: (nlQuery: string) => Promise<void>
  retry: () => Promise<void>
  loadHistory: () => Promise<void>
}

export const useQueryStore = create<QueryState>((set, get) => ({
  result: null,
  loading: false,
  error: null,
  lastQuery: null,
  history: [],
  datasourceId: null,
  setDatasource: (id) => set({ datasourceId: id }),
  ask: async (nlQuery) => {
    set({ loading: true, result: null, error: null, lastQuery: nlQuery })
    try {
      const result = await queryApi.askQuery(nlQuery, get().datasourceId)
      set({ result })
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
