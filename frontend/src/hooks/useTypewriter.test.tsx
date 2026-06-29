import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTypewriter } from './useTypewriter'

function setReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduced-motion') ? matches : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }))
}

afterEach(() => vi.restoreAllMocks())

describe('useTypewriter', () => {
  it('reveals the full text immediately under reduced motion', () => {
    setReducedMotion(true)
    const { result } = renderHook(() => useTypewriter('hello world'))
    expect(result.current).toBe('hello world')
  })

  it('progressively reveals to the full string when animating', async () => {
    setReducedMotion(false)
    const { result } = renderHook(() => useTypewriter('abcdef', 2))
    await waitFor(() => expect(result.current).toBe('abcdef'))
  })

  it('handles empty text', () => {
    setReducedMotion(false)
    const { result } = renderHook(() => useTypewriter(''))
    expect(result.current).toBe('')
  })
})
