import type { Dashboard } from '../../types'
import { DashboardCard } from './DashboardCard'

interface Props {
  dashboard: Dashboard
  onRemoveWidget?: (id: string) => void
}

export function DashboardGrid({ dashboard, onRemoveWidget }: Props) {
  if (!dashboard.widgets.length) {
    return (
      <p className="rounded-2xl border border-dashed border-line px-5 py-10 text-center text-ink-soft">
        Widget yoxdur. Sorğudan əlavə et.
      </p>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {dashboard.widgets.map((w) => (
        <DashboardCard key={w.id} widget={w} onRemove={onRemoveWidget}>
          <p className="font-mono text-xs text-ink-faint">query_log: {w.query_log_id ?? '—'}</p>
        </DashboardCard>
      ))}
    </div>
  )
}
