import { useCallback, useEffect, useState } from 'react'

const MIN_SPAN = 3

export interface ChartZoom {
  /** Visible window as [startIndex, endIndex) into the data array. */
  window: [number, number]
  /** Multiply the visible span (factor < 1 zooms in, > 1 zooms out), keeping
   *  the point under `anchorRatio` (0–1 across the span) fixed. */
  zoomBy: (factor: number, anchorRatio?: number) => void
  /** Shift the window by a whole number of indices. */
  pan: (deltaIdx: number) => void
  reset: () => void
  zoomed: boolean
}

/** Index-window zoom/pan state for a categorical chart over `length` points. */
export function useChartZoom(length: number): ChartZoom {
  const [win, setWin] = useState<[number, number]>([0, length])

  // A new dataset resets the view.
  useEffect(() => {
    setWin([0, length])
  }, [length])

  const clampWin = useCallback(
    (start: number, span: number): [number, number] => {
      const maxSpan = Math.max(1, length)
      const s = Math.min(Math.max(1, Math.round(span)), maxSpan)
      const st = Math.min(Math.max(0, Math.round(start)), maxSpan - s)
      return [st, st + s]
    },
    [length],
  )

  const zoomBy = useCallback(
    (factor: number, anchorRatio = 0.5) => {
      setWin(([start, end]) => {
        const span = end - start
        const minSpan = Math.min(MIN_SPAN, length)
        const next = Math.min(Math.max(minSpan, span * factor), length)
        const anchor = start + anchorRatio * span
        return clampWin(anchor - anchorRatio * next, next)
      })
    },
    [length, clampWin],
  )

  const pan = useCallback(
    (deltaIdx: number) => setWin(([start, end]) => clampWin(start + deltaIdx, end - start)),
    [clampWin],
  )

  const reset = useCallback(() => setWin([0, length]), [length])

  return { window: win, zoomBy, pan, reset, zoomed: win[1] - win[0] < length }
}
