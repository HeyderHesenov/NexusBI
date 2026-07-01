import { create } from 'zustand'
import * as searchApi from '../api/search'
import type { SearchHit } from '../api/search'

interface SearchState {
  open: boolean
  query: string
  hits: SearchHit[]
  loading: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
  setQuery: (query: string) => void
  run: (query: string) => Promise<void>
}

export const useSearchStore = create<SearchState>((set, get) => ({
  open: false,
  query: '',
  hits: [],
  loading: false,
  setOpen: (open) => set(open ? { open } : { open: false, query: '', hits: [] }),
  toggle: () => get().setOpen(!get().open),
  setQuery: (query) => set({ query }),
  run: async (query) => {
    const q = query.trim()
    if (!q) {
      set({ hits: [], loading: false })
      return
    }
    set({ loading: true })
    try {
      const hits = await searchApi.searchAssets(q)
      // Ignore a stale response if the user has typed on since it was issued —
      // gate BOTH hits and the loading flag so an old response can't clear the
      // spinner (and flash "no results") while a newer request is still pending.
      if (get().query.trim() === q) set({ hits, loading: false })
    } catch {
      if (get().query.trim() === q) set({ hits: [], loading: false })
    }
  },
}))
