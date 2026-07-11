import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/** false on first paint, true right after mount — drives CSS grow/fade
 *  transitions (reduced-motion is neutralised by the global index.css guard). */
export function useMounted(): boolean {
  const [m, setM] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setM(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return m
}

/** "Nice" round axis ticks covering [min, max] (~count divisions). */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    const v = Number.isFinite(min) ? min : 0
    return [v]
  }
  const span = max - min
  const step0 = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const norm = step0 / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) {
    out.push(Math.round(v / step) * step)
  }
  return out
}

export interface TipState {
  x: number
  y: number
  node: ReactNode
}

/** Cursor-following styled tooltip. Position is in wrapper-local pixels, so it
 *  works regardless of the SVG's viewBox scaling. */
export function ChartTip({ tip }: { tip: TipState | null }) {
  if (!tip) return null
  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink shadow-pop"
      style={{ left: tip.x, top: tip.y - 10 }}
    >
      {tip.node}
    </div>
  )
}

/** Hover plumbing shared by the SVG charts: a relative wrapper + a helper that
 *  converts a mouse event into wrapper-local tooltip coordinates. */
export function useChartHover() {
  const ref = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<TipState | null>(null)
  const move = (e: { clientX: number; clientY: number }, node: ReactNode) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, node })
  }
  const clear = () => setTip(null)
  return { ref, tip, move, clear }
}
