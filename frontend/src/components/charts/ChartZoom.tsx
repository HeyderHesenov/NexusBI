import { useEffect, useRef, type ReactNode } from 'react'
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { useChartZoom } from './useChartZoom'

const BTN =
  'grid h-7 w-7 place-items-center rounded-md border border-line bg-surface/80 text-ink-soft backdrop-blur transition hover:border-accent hover:text-ink disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-soft'

const DRAG_THRESHOLD = 4 // px before a press becomes a pan (so clicks still drill down)

interface Props {
  data: Record<string, unknown>[]
  children: (slice: Record<string, unknown>[]) => ReactNode
}

/** Wraps a categorical chart with pinch / Ctrl+wheel zoom and drag-to-pan.
 *  Showing fewer points also thins out the x-axis labels, removing clutter.
 *  Plain (no-modifier) wheel is left alone so page scrolling still works. */
export function ChartZoom({ data, children }: Props) {
  const { window: win, zoomBy, pan, reset, zoomed } = useChartZoom(data.length)
  const ref = useRef<HTMLDivElement>(null)
  // Drag bookkeeping; `acc` carries the sub-index remainder between moves.
  const drag = useRef<{
    startX: number
    lastX: number
    span: number
    width: number
    acc: number
    panning: boolean
  } | null>(null)
  // Latest zoom handler for the non-passive wheel listener.
  const zoomRef = useRef(zoomBy)
  zoomRef.current = zoomBy

  // Native listener so we can preventDefault (React's onWheel is passive). Only
  // pinch (ctrlKey on trackpads) or Ctrl/Cmd+wheel zooms — plain wheel scrolls.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (Math.abs(e.deltaY) < 0.5) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const ratio = rect.width ? (e.clientX - rect.left) / rect.width : 0.5
      zoomRef.current(e.deltaY > 0 ? 1.18 : 0.85, ratio)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    if (!zoomed) return // when fully zoomed-out, leave clicks to drill-down
    drag.current = {
      startX: e.clientX,
      lastX: e.clientX,
      span: win[1] - win[0],
      width: e.currentTarget.getBoundingClientRect().width || 1,
      acc: 0,
      panning: false,
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    // Wait for real movement so a plain click still reaches the chart (drill-down).
    if (!d.panning) {
      if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD) return
      d.panning = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    const dx = e.clientX - d.lastX
    d.lastX = e.clientX
    // Drag right → reveal earlier points (window moves left).
    const idxFloat = -(dx / d.width) * d.span + d.acc
    const whole = Math.trunc(idxFloat)
    d.acc = idxFloat - whole
    if (whole) pan(whole)
  }

  const endDrag = () => {
    drag.current = null
  }

  const slice = zoomed ? data.slice(win[0], win[1]) : data

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`relative h-full ${zoomed ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className="pointer-events-none absolute right-1 top-1 z-10 flex items-center gap-1">
        {zoomed && (
          <span className="pointer-events-auto rounded-md border border-line bg-surface/80 px-2 py-0.5 font-mono text-[10px] text-ink-faint backdrop-blur">
            {win[0] + 1}–{win[1]} / {data.length}
          </span>
        )}
        <button
          type="button"
          onClick={() => zoomBy(0.6)}
          title="Yaxınlaşdır (və ya Ctrl + scroll / pinch)"
          aria-label="Yaxınlaşdır"
          className={`pointer-events-auto ${BTN}`}
        >
          <ZoomIn size={14} />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1 / 0.6)}
          disabled={!zoomed}
          aria-label="Uzaqlaşdır"
          className={`pointer-events-auto ${BTN}`}
        >
          <ZoomOut size={14} />
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={!zoomed}
          aria-label="Sıfırla"
          className={`pointer-events-auto ${BTN}`}
        >
          <RotateCcw size={13} />
        </button>
      </div>
      {children(slice)}
    </div>
  )
}
