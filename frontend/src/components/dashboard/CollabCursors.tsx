import { MousePointer2 } from 'lucide-react'
import { useCollabStore } from '../../store/collabStore'

/** Renders remote collaborators' cursors. Coordinates are 0–1 fractions of the
 *  positioned parent, so they map across different screen sizes. The parent must
 *  be `relative`. This layer never intercepts pointer events. */
export function CollabCursors() {
  const cursors = useCollabStore((s) => s.cursors)
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {Object.values(cursors).map((c) => (
        <div
          key={c.conn_id}
          className="absolute -translate-x-1 -translate-y-1 transition-[left,top] duration-75 ease-linear"
          style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
        >
          <MousePointer2 size={18} style={{ color: c.color }} fill={c.color} strokeWidth={1} />
          <span
            className="ml-3 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium text-white shadow-sm"
            style={{ background: c.color }}
          >
            {c.name}
          </span>
        </div>
      ))}
    </div>
  )
}
