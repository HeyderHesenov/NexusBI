import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, ChevronDown, Lightbulb, Target, TrendingDown, TrendingUp, Trash2 } from 'lucide-react'
import { useDecisionStore } from '../store/decisionStore'
import { formatNumber } from '../lib/format'
import { Sparkline } from '../components/charts/Sparkline'
import { TypewriterText } from '../components/charts/TypewriterText'
import { FIELD } from '../components/ui/form'
import * as decisionApi from '../api/decision'
import type { Decision, DecisionStatus, DecisionTrajectory, ImpactStatus } from '../types'

// recharts is heavy — keep it out of the Decisions bundle until a card is expanded.
const TrajectoryChart = lazy(() =>
  import('../components/decision/TrajectoryChart').then((m) => ({ default: m.TrajectoryChart })),
)

const STATUS: { value: DecisionStatus; labelKey: string }[] = [
  { value: 'open', labelKey: 'decisionsPage.statusOpen' },
  { value: 'in_progress', labelKey: 'decisionsPage.statusInProgress' },
  { value: 'done', labelKey: 'decisionsPage.statusDone' },
]

const STATUS_STYLE: Record<DecisionStatus, string> = {
  open: 'border-line text-ink-soft',
  in_progress: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  done: 'border-accent/40 bg-accent-soft text-accent',
}

const IMPACT: Record<ImpactStatus, { labelKey: string; cls: string }> = {
  pending: { labelKey: 'decisionsPage.impactPending', cls: 'border-line text-ink-faint' },
  on_track: { labelKey: 'decisionsPage.impactOnTrack', cls: 'border-accent/40 bg-accent-soft text-accent' },
  achieved: { labelKey: 'decisionsPage.impactAchieved', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' },
  missed: { labelKey: 'decisionsPage.impactMissed', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  regressed: { labelKey: 'decisionsPage.impactRegressed', cls: 'border-red-500/40 bg-red-500/10 text-red-400' },
}

const fmt = (n: number | null) => (n == null ? '—' : formatNumber(n, { compact: true, decimals: 2 }))

export function DecisionsPage() {
  const { t } = useTranslation()
  const { items, accuracy, load, loadAccuracy, patch, measure, remove } = useDecisionStore()

  useEffect(() => {
    load().catch(() => undefined)
    loadAccuracy().catch(() => undefined)
  }, [load, loadAccuracy])

  return (
    <div className="w-full">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t('decisionsPage.eyebrow')}</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">
            {t('decisionsPage.title')}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {t('decisionsPage.subtitle')}
          </p>
        </div>
        {accuracy && accuracy.total_measured > 0 && (
          <div className="rounded-2xl border border-line bg-surface px-4 py-3 text-right">
            <p className="eyebrow flex items-center justify-end gap-1.5">
              <Activity size={12} /> {t('decisionsPage.decisionAccuracy')}
            </p>
            <p className="mt-1 font-display text-2xl font-bold text-ink">
              {accuracy.accuracy_pct == null ? '—' : `${accuracy.accuracy_pct}%`}
            </p>
            <p className="text-xs text-ink-faint">
              {t('decisionsPage.targetsReached', { achieved: accuracy.achieved, total: accuracy.total_measured })}
            </p>
          </div>
        )}
      </header>

      {items.length === 0 ? (
        <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <Target size={22} className="mx-auto text-ink-faint" />
          <p className="mt-2 font-display text-lg text-ink">{t('decisionsPage.emptyTitle')}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {t('decisionsPage.emptyHint')}
          </p>
        </div>
      ) : (
        <ul className="grid items-start gap-3 lg:grid-cols-2">
          {items.map((d) => (
            <DecisionCard key={d.id} d={d} onPatch={patch} onMeasure={measure} onRemove={remove} />
          ))}
        </ul>
      )}
    </div>
  )
}

function DecisionCard({
  d,
  onPatch,
  onMeasure,
  onRemove,
}: {
  d: Decision
  onPatch: (id: string, p: { status?: DecisionStatus; outcome?: string }) => Promise<void>
  onMeasure: (id: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [outcome, setOutcome] = useState(d.outcome)
  const [traj, setTraj] = useState<DecisionTrajectory | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const tracked = d.baseline_value != null

  // A sparkline needs >=2 points, so only fetch once a realized value exists.
  // Keyed on realized_at: onMeasure updates it via the store, which refetches once.
  useEffect(() => {
    if (!tracked || d.realized_value == null) return
    let ignore = false // drop an out-of-order response so stale points can't clobber fresh ones
    decisionApi.trajectory(d.id).then((tr) => !ignore && setTraj(tr)).catch(() => undefined)
    return () => {
      ignore = true
    }
  }, [d.id, tracked, d.realized_value, d.realized_at])

  const cf = traj?.counterfactual ?? null
  const points = traj?.points ?? []

  const doMeasure = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onMeasure(d.id) // store update bumps realized_at → effect refetches the trajectory
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  const impact = IMPACT[d.impact_status]
  const delta =
    d.baseline_value != null && d.realized_value != null && d.baseline_value !== 0
      ? ((d.realized_value - d.baseline_value) / Math.abs(d.baseline_value)) * 100
      : null

  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-ink">{d.title}</p>
        <div className="flex shrink-0 items-center gap-1">
          <select
            value={d.status}
            onChange={(e) => onPatch(d.id, { status: e.target.value as DecisionStatus })}
            className={`rounded-lg border bg-surface-2 px-2 py-1.5 text-xs focus:outline-none ${STATUS_STYLE[d.status]}`}
          >
            {STATUS.map((s) => (
              <option key={s.value} value={s.value}>{t(s.labelKey)}</option>
            ))}
          </select>
          <button
            onClick={() => onRemove(d.id)}
            title={t('decisionsPage.delete')}
            className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {tracked && (
        <div className="mt-3 rounded-xl border border-line bg-surface-2/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-xs ${impact.cls}`}>{t(impact.labelKey)}</span>
            <button
              onClick={doMeasure}
              disabled={busy}
              className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-soft transition hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {busy ? t('decisionsPage.measuring') : t('decisionsPage.measureNow')}
            </button>
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="eyebrow">{t('decisionsPage.baseline')}</p>
                <p className="font-mono text-ink">{fmt(d.baseline_value)}</p>
              </div>
              <div>
                <p className="eyebrow">{t('decisionsPage.forecast')}</p>
                <p className="font-mono text-ink-soft">{fmt(d.predicted_value)}</p>
              </div>
              <div>
                <p className="eyebrow">{t('decisionsPage.real')}</p>
                <p className="flex items-center gap-1 font-mono text-ink">
                  {fmt(d.realized_value)}
                  {delta != null && delta !== 0 &&
                    (delta > 0 ? (
                      <TrendingUp size={13} className="text-emerald-400" />
                    ) : (
                      <TrendingDown size={13} className="text-red-400" />
                    ))}
                </p>
              </div>
            </div>
            <Sparkline points={points.map((p) => p.value)} />
          </div>
          {delta != null && (
            <p className="mt-1 text-xs text-ink-faint">
              {t('decisionsPage.changeFromBaseline')}: {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
            </p>
          )}

          {points.length >= 2 && (
            <>
              <button
                onClick={() => setExpanded((v) => !v)}
                className="mt-2 inline-flex items-center gap-1 text-xs text-ink-soft transition hover:text-accent"
              >
                <ChevronDown size={13} className={`transition ${expanded ? 'rotate-180' : ''}`} />
                {t('decisionsPage.trajectory')}
              </button>
              {expanded && (
                <div className="mt-2 border-t border-line pt-3">
                  {cf?.method === 'baseline' ? (
                    // No usable pre-decision history: a baseline delta is NOT a true
                    // counterfactual, so say so plainly instead of drawing a fake band.
                    <p className="mb-2 text-xs text-ink-faint">{t('decisionsPage.counterfactualBaselineNote')}</p>
                  ) : (
                    cf?.delta_vs_counterfactual != null && (
                      <p className="mb-2 text-xs text-ink-soft">
                        {t('decisionsPage.vsCounterfactual')}:{' '}
                        <span className={cf.delta_vs_counterfactual >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {cf.delta_vs_counterfactual > 0 ? '+' : ''}
                          {fmt(cf.delta_vs_counterfactual)}
                        </span>
                      </p>
                    )
                  )}
                  {traj && (
                    <Suspense fallback={<div className="h-[220px]" />}>
                      <TrajectoryChart trajectory={traj} baseline={d.baseline_value} />
                    </Suspense>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {d.insight && (
        <div className="mt-2 flex items-start gap-1.5 text-sm text-ink-soft">
          <Lightbulb size={14} className="mt-0.5 shrink-0 text-accent" />
          <TypewriterText text={d.insight} />
        </div>
      )}
      {d.action && <p className="mt-1 text-sm text-ink"><span className="text-ink-faint">{t('decisionsPage.step')}:</span> {d.action}</p>}

      <div className="mt-3">
        <p className="eyebrow mb-1">{t('decisionsPage.outcomeLabel')}</p>
        <textarea
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          onBlur={() => outcome !== d.outcome && onPatch(d.id, { outcome })}
          placeholder={t('decisionsPage.outcomePlaceholder')}
          rows={2}
          className={FIELD}
        />
      </div>
    </li>
  )
}
