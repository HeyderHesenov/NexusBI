import { create } from 'zustand'
import type { QueryHistoryItem, QueryResult } from '../types'
import * as queryApi from '../api/query'

interface QueryState {
  result: QueryResult | null
  loading: boolean
  history: QueryHistoryItem[]
  datasourceId: string | null
  setDatasource: (id: string | null) => void
  ask: (nlQuery: string) => Promise<void>
  loadHistory: () => Promise<void>
}

export const useQueryStore = create<QueryState>((set, get) => ({
  result: null,
  loading: false,
  history: [],
  datasourceId: null,
  setDatasource: (id) => set({ datasourceId: id }),
  ask: async (nlQuery) => {
    set({ loading: true, result: null })
    try {
      const result = await queryApi.askQuery(nlQuery, get().datasourceId)
      set({ result })
      await get().loadHistory()
    } finally {
      set({ loading: false })
    }
  },
  loadHistory: async () => {
    const page = await queryApi.getHistory(1, 20)
    set({ history: page.items })
  },
}))
