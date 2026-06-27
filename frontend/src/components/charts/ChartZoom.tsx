import { useEffect, useRef, type ReactNode } from 'react'
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { useChartZoom } from './useChartZoom'

const BTN =
  'grid h-7 w-7 place-items-center rounded-md border border-line bg-surface/80 text-ink-soft backdrop-blur transition hover:border-accent hover:text-ink disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-soft'

const DRAG_THRESHOLD = 4 // px before a press becomes a pan (so clicks still drill down)

interface Props {
  data: Record<string, unknown>[]
  children: (slice: Record<string, unknown>[]) => ReactNode
  /** Index axis orientation: 'x' for upright charts (line/area/vertical),
   *  'y' for horizontal bars (categories run top→bottom). Drives which wheel/
   *  drag delta and anchor dimension drive zoom + pan. */
  axis?: 'x' | 'y'
}

/** Wraps a categorical chart with zoom + pan. Zoom: Ctrl/⌘ + wheel, pinch, or the
 *  +/− buttons. Pan (only while zoomed): a plain wheel scrolls along the index
 *  axis (up/down for horizontal bars), or drag. Plain wheel while unzoomed is
 *  left alone so the page can still scroll. */
export function ChartZoom({ data, children, axis = 'x' }: Props) {
  const { window: win, zoomBy, pan, reset, zoomed } = useChartZoom(data.length)
  const ref = useRef<HTMLDivElement>(null)
  // Drag bookkeeping; `acc` carries the sub-index remainder between moves.
  const drag = useRef<{
    start: number
    last: number
    span: number
    size: number
    acc: number
    panning: boolean
  } | null>(null)
  // Latest state for the non-passive wheel listener (re-attached on change).
  const zoomRef = useRef(zoomBy)
  zoomRef.current = zoomBy
  const panRef = useRef(pan)
  panRef.current = pan
  const winRef = useRef(win)
  winRef.current = win
  const wheelAcc = useRef(0)

  // Native listener so we can preventDefault (React's onWheel is passive).
  // Ctrl/⌘ + wheel (or trackpad pinch, which sets ctrlKey) zooms; a plain wheel
  // pans along the index axis while zoomed, else falls through to page scroll.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        if (Math.abs(e.deltaY) < 0.5) return
        e.preventDefault()
        const ratio =
          axis === 'y'
            ? rect.height
              ? (e.clientY - rect.top) / rect.height
              : 0.5
            : rect.width
              ? (e.clientX - rect.left) / rect.width
              : 0.5
        // Per-notch step (~12%); 1.14 ≈ 1/0.88 keeps in/out symmetric.
        zoomRef.current(e.deltaY > 0 ? 0.88 : 1.14, ratio)
        return
      }
      // Plain wheel: pan only when zoomed; otherwise let the page scroll.
      if (!zoomed) return
      const delta = axis === 'y' ? e.deltaY : e.deltaX || e.deltaY
      if (Math.abs(delta) < 0.5) return
      e.preventDefault()
      const size = (axis === 'y' ? rect.height : rect.width) || 1
      const span = winRef.current[1] - winRef.current[0]
      wheelAcc.current += (delta / size) * span
      const whole = Math.trunc(wheelAcc.current)
      wheelAcc.current -= whole
      if (whole) panRef.current(whole) // scroll down/right → later indices
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [axis, zoomed])

  const onPointerDown = (e: React.PointerEvent) => {
    if (!zoomed) return // when fully zoomed-out, leave clicks to drill-down
    const rect = e.currentTarget.getBoundingClientRect()
    drag.current = {
      start: axis === 'y' ? e.clientY : e.clientX,
      last: axis === 'y' ? e.clientY : e.clientX,
      span: win[1] - win[0],
      size: (axis === 'y' ? rect.height : rect.width) || 1,
      acc: 0,
      panning: false,
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const pos = axis === 'y' ? e.clientY : e.clientX
    // Wait for real movement so a plain click still reaches the chart (drill-down).
    if (!d.panning) {
      if (Math.abs(pos - d.start) < DRAG_THRESHOLD) return
      d.panning = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    const delta = pos - d.last
    d.last = pos
    // Drag down/right → reveal earlier points (window moves toward the start).
    const idxFloat = -(delta / d.size) * d.span + d.acc
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
          title="Yaxınlaşdır (Ctrl/⌘ + scroll, pinch). Zoom-dan sonra adi scroll sürüşdürür."
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
