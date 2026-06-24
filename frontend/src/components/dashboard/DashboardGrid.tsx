import type { Dashboard } from '../../types'
import { DashboardCard } from './DashboardCard'

interface Props {
  dashboard: Dashboard
  onRemoveWidget?: (id: string) => void
}

export function DashboardGrid({ dashboard, onRemoveWidget }: Props) {
  if (!dashboard.widgets.length) {
    return <p className="text-slate-400">Widget yoxdur. Sorğudan əlavə et.</p>
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {dashboard.widgets.map((w) => (
        <DashboardCard key={w.id} widget={w} onRemove={onRemoveWidget}>
          <p className="text-xs text-slate-500">query_log: {w.query_log_id ?? '—'}</p>
        </DashboardCard>
      ))}
    </div>
  )
}
