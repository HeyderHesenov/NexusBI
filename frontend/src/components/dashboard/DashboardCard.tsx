import { X } from 'lucide-react'
import type { Widget } from '../../types'

interface Props {
  widget: Widget
  onRemove?: (id: string) => void
  children: React.ReactNode
}

export function DashboardCard({ widget, onRemove, children }: Props) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-ink">{widget.title || 'Widget'}</span>
        {onRemove && (
          <button
            onClick={() => onRemove(widget.id)}
            className="text-ink-faint transition hover:text-[#D87C6B]"
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  )
}
