import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'

const BTN =
  'grid h-7 w-7 place-items-center rounded-md border border-line bg-surface/80 text-ink-soft backdrop-blur transition hover:border-accent hover:text-ink disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-soft'

const MIN_ZOOM = 0.6
const MAX_ZOOM = 4
const STEP = 1.25 // per zoom-in notch (button / wheel)
const DRAG_THRESHOLD = 4 // px before a press becomes a grab-scroll (clicks still drill down)

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

interface Props {
  height: number | string
  /** Renders the (tall) chart content sized for the given magnification. */
  children: (zoom: number) => ReactNode
}

/** Fixed-height viewport that scrolls through a tall chart, with a *magnify*
 *  zoom (Ctrl/⌘ + wheel, pinch, or +/− buttons) that resizes the content rather
 *  than windowing the data. Plain wheel scrolls natively; drag grabs-and-scrolls.
 *  Used for horizontal bar charts so every column is reachable by scrolling while
 *  zoom changes how big each bar is. */
export function ScrollZoom({ height, children }: Props) {
  const [zoom, setZoom] = useState(1)
  const viewportRef = useRef<HTMLDivElement>(null)
  // Drag bookkeeping; `moved` suppresses the click that would otherwise drill down.
  const drag = useRef<{ startY: number; startTop: number; panning: boolean } | null>(null)
  const moved = useRef(false)

  // Native (non-passive) wheel so Ctrl/⌘ + wheel can preventDefault (React's
  // onWheel is passive) and magnify around the cursor; a plain wheel is left
  // alone so the viewport scrolls natively.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return // plain wheel → native scroll
      if (Math.abs(e.deltaY) < 0.5) return
      e.preventDefault()
      const cursorY = e.clientY - el.getBoundingClientRect().top
      setZoom((z) => {
        const next = clampZoom(z * (e.deltaY > 0 ? 1 / STEP : STEP))
        if (next !== z) {
          // Keep the content point under the cursor roughly fixed.
          el.scrollTop = (el.scrollTop + cursorY) * (next / z) - cursorY
        }
        return next
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const zoomByButton = (factor: number) => setZoom((z) => clampZoom(z * factor))

  const onPointerDown = (e: React.PointerEvent) => {
    const el = viewportRef.current
    if (!el) return
    drag.current = { startY: e.clientY, startTop: el.scrollTop, panning: false }
    moved.current = false
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const el = viewportRef.current
    if (!d || !el) return
    const dy = e.clientY - d.startY
    if (!d.panning) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return // small move → still a click (drill-down)
      d.panning = true
      moved.current = true
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* no active pointer (e.g. synthetic event) — capture is best-effort */
      }
    }
    el.scrollTop = d.startTop - dy
  }

  const endDrag = () => {
    drag.current = null
  }

  // After a real drag, swallow the trailing click so it doesn't drill down.
  const onClickCapture = (e: React.MouseEvent) => {
    if (moved.current) {
      e.stopPropagation()
      moved.current = false
    }
  }

  return (
    <div className="relative" style={{ height }}>
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        className="h-full overflow-y-auto pr-1 cursor-grab active:cursor-grabbing"
      >
        {children(zoom)}
      </div>
      <div className="absolute right-1 top-1 z-10 flex items-center gap-1">
        <button
          type="button"
          onClick={() => zoomByButton(STEP)}
          disabled={zoom >= MAX_ZOOM}
          title="Böyüt (Ctrl/⌘ + scroll, pinch). Adi scroll sütunları gəzir."
          aria-label="Böyüt"
          className={BTN}
        >
          <ZoomIn size={14} />
        </button>
        <button
          type="button"
          onClick={() => zoomByButton(1 / STEP)}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Kiçilt"
          className={BTN}
        >
          <ZoomOut size={14} />
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          disabled={zoom === 1}
          aria-label="Sıfırla"
          className={BTN}
        >
          <RotateCcw size={13} />
        </button>
      </div>
    </div>
  )
}
