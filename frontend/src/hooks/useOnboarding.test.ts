import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mutable store states the mocked hooks read from.
const state = {
  user: { id: 'u1', email: 'real@user.io' } as { id: string; email: string } | null,
  history: [] as unknown[],
  dashboards: [] as unknown[],
  saved: [] as unknown[],
  sources: [] as unknown[],
}
const noop = () => Promise.resolve()

vi.mock('../store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: state.user }),
}))
vi.mock('../store/queryStore', () => ({
  useQueryStore: (sel: (s: unknown) => unknown) => sel({ history: state.history }),
}))
vi.mock('../store/dashboardStore', () => ({
  useDashboardStore: (sel: (s: unknown) => unknown) => sel({ list: state.dashboards, loadList: noop }),
}))
vi.mock('../store/savedQueryStore', () => ({
  useSavedQueryStore: (sel: (s: unknown) => unknown) => sel({ items: state.saved, load: noop }),
}))
vi.mock('../store/datasourceStore', () => ({
  useDatasourceStore: (sel: (s: unknown) => unknown) => sel({ sources: state.sources, load: noop }),
}))

import { useOnboarding } from './useOnboarding'

beforeEach(() => {
  state.user = { id: 'u1', email: 'real@user.io' }
  state.history = []
  state.dashboards = []
  state.saved = []
  state.sources = []
  localStorage.clear()
})

describe('useOnboarding', () => {
  it('is visible for a fresh real user with nothing done', () => {
    const { result } = renderHook(() => useOnboarding())
    expect(result.current.visible).toBe(true)
    expect(result.current.completed).toBe(0)
    expect(result.current.total).toBe(4)
    expect(result.current.steps.every((s) => !s.done)).toBe(true)
  })

  it('ticks each step off from the derived store counts', () => {
    state.sources = [{}]
    state.history = [{}]
    state.saved = [{}]
    const { result } = renderHook(() => useOnboarding())
    const done = Object.fromEntries(result.current.steps.map((s) => [s.key, s.done]))
    expect(done).toEqual({ source: true, query: true, save: true, dashboard: false })
    expect(result.current.completed).toBe(3)
    expect(result.current.visible).toBe(true)
  })

  it('hides once every step is complete', () => {
    state.sources = [{}]
    state.history = [{}]
    state.saved = [{}]
    state.dashboards = [{}]
    const { result } = renderHook(() => useOnboarding())
    expect(result.current.completed).toBe(4)
    expect(result.current.visible).toBe(false)
  })

  it('persists completion so a finished user stays hidden on later visits', () => {
    state.sources = [{}]
    state.history = [{}]
    state.saved = [{}]
    state.dashboards = [{}]
    renderHook(() => useOnboarding())
    // reaching all-done writes the same per-user flag a manual dismiss would
    expect(localStorage.getItem('nexusbi.onboarding.dismissed.u1')).toBe('1')
  })

  it('is hidden for the demo account', () => {
    state.user = { id: 'demo', email: 'demo@nexusbi.io' }
    const { result } = renderHook(() => useOnboarding())
    expect(result.current.visible).toBe(false)
  })

  it('is hidden when logged out', () => {
    state.user = null
    const { result } = renderHook(() => useOnboarding())
    expect(result.current.visible).toBe(false)
  })

  it('dismiss persists per-user and hides the card', () => {
    const { result } = renderHook(() => useOnboarding())
    expect(result.current.visible).toBe(true)
    act(() => result.current.dismiss())
    expect(result.current.visible).toBe(false)
    expect(localStorage.getItem('nexusbi.onboarding.dismissed.u1')).toBe('1')
  })

  it('reads a previously stored dismissal on mount', () => {
    localStorage.setItem('nexusbi.onboarding.dismissed.u1', '1')
    const { result } = renderHook(() => useOnboarding())
    expect(result.current.visible).toBe(false)
    // A different user is not affected by u1's dismissal.
    state.user = { id: 'u2', email: 'other@user.io' }
    const { result: r2 } = renderHook(() => useOnboarding())
    expect(r2.current.visible).toBe(true)
  })
})
