import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface ContextMenuItem {
  label: string
  icon?: LucideIcon
  onSelect: () => void
  destructive?: boolean
}

interface Props {
  /** Screen coordinates (clientX/clientY) where the menu opens. */
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

/** Lightweight right-click menu anchored at a cursor position.
 *  Closes on outside click, Escape, scroll or resize. Clamps to the viewport. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // Keep the menu fully on-screen.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.min(x, window.innerWidth - width - 8),
      y: Math.min(y, window.innerHeight - height - 8),
    })
  }, [x, y])

  useEffect(() => {
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }}>
      <div
        ref={ref}
        style={{ left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
        className="fixed min-w-[160px] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-pop"
      >
        {items.map((item) => (
          <button
            key={item.label}
            onClick={() => {
              item.onSelect()
              onClose()
            }}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-surface-2 ${
              item.destructive ? 'text-[#D87C6B]' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {item.icon && <item.icon size={15} />}
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
