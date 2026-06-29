import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useChartZoom } from './useChartZoom'

describe('useChartZoom', () => {
  it('starts fully zoomed out and not zoomed', () => {
    const { result } = renderHook(() => useChartZoom(100))
    expect(result.current.window).toEqual([0, 100])
    expect(result.current.zoomed).toBe(false)
  })

  it('zooms in around the anchor and flags zoomed', () => {
    const { result } = renderHook(() => useChartZoom(100))
    act(() => result.current.zoomBy(0.5, 0.5))
    const [s, e] = result.current.window
    expect(e - s).toBe(50)
    expect(s).toBe(25) // centered anchor keeps the midpoint
    expect(result.current.zoomed).toBe(true)
  })

  it('never shrinks below the minimum span', () => {
    const { result } = renderHook(() => useChartZoom(100))
    act(() => result.current.zoomBy(0.001))
    const [s, e] = result.current.window
    expect(e - s).toBe(3) // MIN_SPAN
  })

  it('clamps a pan to the data bounds', () => {
    const { result } = renderHook(() => useChartZoom(100))
    act(() => result.current.zoomBy(0.5)) // span 50, window [25,75]
    act(() => result.current.pan(1000)) // pan way past the end
    const [s, e] = result.current.window
    expect(e).toBe(100)
    expect(s).toBe(50)
  })

  it('reset restores the full window', () => {
    const { result } = renderHook(() => useChartZoom(100))
    act(() => result.current.zoomBy(0.3))
    act(() => result.current.reset())
    expect(result.current.window).toEqual([0, 100])
    expect(result.current.zoomed).toBe(false)
  })
})
