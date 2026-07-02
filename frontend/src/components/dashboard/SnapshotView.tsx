import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownRight, ArrowUpRight, Minus, PlusCircle, Trash2 } from 'lucide-react'
import { ChartRenderer } from '../charts/LazyChartRenderer'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { diffSnapshot, type WidgetDelta } from '../../lib/snapshotDiff'
import type { ChartType, Dashboard, SnapshotFull } from '../../types'

interface Props {
  snapshot: SnapshotFull
  dashboard: Dashboard
}

function DeltaBadge({ delta }: { delta: WidgetDelta }) {
  const { t } = useTranslation()
  if (delta.status === 'missing_now') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#D87C6B]/10 px-2 py-0.5 text-[11px] font-medium text-[#D87C6B]">
        <Trash2 size={11} /> {t('timeMachine.missingNow')}
      </span>
    )
  }
  if (delta.status === 'same') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-faint">
        <Minus size={11} /> {t('timeMachine.unchanged')}
      </span>
    )
  }
  // Changed but with no computable ratio (zero/absent baseline): say "changed",
  // never "unchanged" — a 0 → 500 jump must not read as no movement.
  if (delta.deltaPct === null) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent"
        title={`${delta.before ?? '—'} → ${delta.after ?? '—'}`}
      >
        {t('timeMachine.changed')}
      </span>
    )
  }
  const up = delta.deltaPct > 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        up ? 'bg-accent-soft text-accent' : 'bg-[#D87C6B]/10 text-[#D87C6B]'
      }`}
      title={`${delta.before ?? '—'} → ${delta.after ?? '—'}`}
    >
      <Icon size={11} />
      {up ? '+' : ''}
      {delta.deltaPct}% {t('timeMachine.sinceThen')}
    </span>
  )
}

/** Read-only view of a snapshot's widgets, each annotated with its drift vs now. */
export function SnapshotView({ snapshot, dashboard }: Props) {
  const { t } = useTranslation()
  const deltas = useMemo(
    () => diffSnapshot(snapshot.widgets, dashboard.widgets),
    [snapshot, dashboard],
  )
  const byId = useMemo(() => new Map(deltas.map((d) => [d.widgetId, d])), [deltas])
  const newSince = deltas.filter((d) => d.status === 'new_since')

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        {snapshot.widgets.map((w) => {
          const delta = byId.get(w.widget_id)
          return (
            <div key={w.widget_id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">{w.title}</h3>
                {delta && <DeltaBadge delta={delta} />}
              </div>
              <ErrorBoundary>
                {w.rows.length ? (
                  <ChartRenderer
                    data={w.rows}
                    config={{
                      ...w.chart_config,
                      chart_type: (w.chart_config.chart_type ?? w.chart_type) as ChartType,
                    }}
                    height={240}
                  />
                ) : (
                  <p className="text-sm text-ink-soft">{t('timeMachine.noData')}</p>
                )}
              </ErrorBoundary>
            </div>
          )
        })}
      </div>
      {newSince.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
          <PlusCircle size={13} className="text-accent" />
          {t('timeMachine.newSince')}:
          {newSince.map((d) => (
            <span key={d.widgetId} className="rounded-full border border-line px-2 py-0.5">
              {d.title}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
