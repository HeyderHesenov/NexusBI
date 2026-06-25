import { create } from 'zustand'

type Mode = 'light' | 'dark'
const KEY = 'nexusbi_theme'

function read(): Mode {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function apply(mode: Mode) {
  document.documentElement.classList.toggle('dark', mode === 'dark')
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* ignore */
  }
}

interface ThemeState {
  mode: Mode
  toggle: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const mode = read()
  apply(mode) // keep <html> in sync with persisted value on load
  return {
    mode,
    toggle: () => {
      const next: Mode = get().mode === 'dark' ? 'light' : 'dark'
      apply(next)
      set({ mode: next })
    },
  }
})
