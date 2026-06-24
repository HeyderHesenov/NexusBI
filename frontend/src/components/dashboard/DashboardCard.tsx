import { X } from 'lucide-react'
import type { Widget } from '../../types'

interface Props {
  widget: Widget
  onRemove?: (id: string) => void
  children: React.ReactNode
}

export function DashboardCard({ widget, onRemove, children }: Props) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-grid bg-panel p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-ink">{widget.title || 'Widget'}</span>
        {onRemove && (
          <button
            onClick={() => onRemove(widget.id)}
            className="text-muted transition hover:text-[#C84B5A]"
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  )
}
