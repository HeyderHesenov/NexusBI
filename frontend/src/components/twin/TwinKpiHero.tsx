import { useTranslation } from 'react-i18next'
import { Check, TrendingDown, TrendingUp } from 'lucide-react'
import { formatMetricValue as fmt, formatSignedPct } from '../../lib/format'
import { useCountUp } from '../../hooks/useCountUp'
import { DANGER } from '../charts/theme'
import { Sparkline } from '../charts/Sparkline'

interface Props {
  baseline: number
  simulated: number
  deltaPct: number | null
  /** Cumulative KPI path (baseline → each applied lever) for the sparkline. */
  points: number[]
  active: boolean
  uncertainty?: { p10: number; p90: number } | null
  pacing?: { attainmentPct: number; onTrack: boolean; hit: boolean } | null
  target?: { name: string; value: number } | null
}

/** The scenario's live result: a big count-up KPI with a delta chip, trend
 *  path, optional P10–P90 uncertainty band and KPI-target pacing. */
export function TwinKpiHero({ baseline, simulated, deltaPct, points, active, uncertainty, pacing, target }: Props) {
  const { t } = useTranslation()
  const shown = useCountUp(simulated)
  const up = (deltaPct ?? 0) >= 0
  const rounded = deltaPct == null ? null : Math.round(deltaPct * 10) / 10

  return (
    <div className="plot-grid relative overflow-hidden rounded-2xl border border-line bg-surface-2 p-6 shadow-card sm:p-8">
      <span className="absolute right-6 top-6 h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent))]" />
      <p className="eyebrow">{t('twinPage.result')}</p>

      <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-3">
        <span className="font-display text-5xl font-bold leading-none text-ink tabular-nums sm:text-6xl">
          {fmt(shown)}
        </span>
        {active && rounded != null && (
          <div className="flex items-center gap-3 pb-1">
            <span
              className="flex items-center gap-1 text-sm font-semibold tabular-nums"
              style={up ? { color: 'rgb(var(--accent))' } : { color: DANGER }}
            >
              {up ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
              {formatSignedPct(deltaPct!)}
            </span>
            {points.length >= 2 && <Sparkline points={points} trend={up ? 'up' : 'down'} width={130} height={30} />}
          </div>
        )}
      </div>

      <p className="mt-2 font-mono text-xs text-ink-faint">
        {t('twinPage.baseline')}: <span className="tabular-nums">{fmt(baseline)}</span>
      </p>

      {uncertainty && <UncertaintyBand p10={uncertainty.p10} p90={uncertainty.p90} value={simulated} />}

      {pacing && target && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-soft">
            {target.name} · {t('chart.target')} <span className="font-mono tabular-nums text-ink">{fmt(target.value)}</span>
          </span>
          <span className="font-mono tabular-nums text-ink-soft">· {pacing.attainmentPct}%</span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              pacing.hit ? 'bg-accent text-bg' : pacing.onTrack ? 'bg-accent-soft text-accent' : 'bg-surface'
            }`}
            style={!pacing.hit && !pacing.onTrack ? { color: DANGER } : undefined}
          >
            {pacing.hit && <Check size={11} />}
            {pacing.hit ? t('twinPage.pacing.hit') : pacing.onTrack ? t('kpi.onTrack') : t('kpi.behind')}
          </span>
        </div>
      )}
    </div>
  )
}

/** A P10 … P90 range track with the point estimate marked. */
function UncertaintyBand({ p10, p90, value }: { p10: number; p90: number; value: number }) {
  const { t } = useTranslation()
  const min = Math.min(p10, value)
  const max = Math.max(p90, value)
  const span = max - min || 1
  const pos = (v: number) => `${((v - min) / span) * 100}%`
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between font-mono text-[11px] text-ink-faint">
        <span>P10 {fmt(p10)}</span>
        <span className="uppercase tracking-wider">{t('twinPage.monteCarlo.distribution')}</span>
        <span>P90 {fmt(p90)}</span>
      </div>
      <div className="relative mt-1.5 h-2 rounded-full bg-surface">
        <div
          className="absolute inset-y-0 rounded-full bg-accent/30"
          style={{ left: pos(p10), right: `${100 - ((p90 - min) / span) * 100}%` }}
        />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent shadow-[0_0_6px_rgb(var(--accent))]"
          style={{ left: pos(value) }}
        />
      </div>
    </div>
  )
}
