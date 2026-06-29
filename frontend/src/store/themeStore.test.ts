import { beforeEach, describe, expect, it } from 'vitest'
import { useThemeStore } from './themeStore'

describe('themeStore', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    useThemeStore.setState({ mode: 'light' })
  })

  it('toggles light → dark and back', () => {
    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().mode).toBe('dark')
    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().mode).toBe('light')
  })

  it('syncs the <html>.dark class with the mode', () => {
    useThemeStore.getState().toggle()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    useThemeStore.getState().toggle()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('persists the mode to localStorage', () => {
    useThemeStore.getState().toggle()
    expect(localStorage.getItem('nexusbi_theme')).toBe('dark')
  })
})
