import { useRef, type ReactNode } from 'react'
import { useCollabStore } from '../../store/collabStore'
import { CollabCursors } from './CollabCursors'

/** Wraps dashboard content: broadcasts the local cursor (rAF-throttled, as a
 *  0–1 fraction of this box) and overlays remote cursors. */
export function CollabSurface({ children }: { children: ReactNode }) {
  const sendCursor = useCollabStore((s) => s.sendCursor)
  const ref = useRef<HTMLDivElement>(null)
  const frame = useRef<number | null>(null)

  const onMove = (e: React.MouseEvent) => {
    const { clientX, clientY } = e
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const x = (clientX - r.left) / r.width
      const y = (clientY - r.top) / r.height
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) sendCursor(x, y)
    })
  }

  return (
    <div ref={ref} onMouseMove={onMove} className="relative">
      {children}
      <CollabCursors />
    </div>
  )
}
