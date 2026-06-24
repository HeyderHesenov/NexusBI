import { X } from 'lucide-react'
import type { Widget } from '../../types'

interface Props {
  widget: Widget
  onRemove?: (id: string) => void
  children: React.ReactNode
}

export function DashboardCard({ widget, onRemove, children }: Props) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-700 bg-slate-900 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-200">{widget.title || 'Widget'}</span>
        {onRemove && (
          <button onClick={() => onRemove(widget.id)} className="text-slate-500 hover:text-red-400">
            <X size={16} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  )
}
