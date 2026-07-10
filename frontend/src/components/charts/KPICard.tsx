import { TrendingDown, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KPITarget } from '../../api/scenario'
import type { ChartConfig } from '../../types'
import { useCountUp } from '../../hooks/useCountUp'
import { useChartValueFormatter } from '../../hooks/useChartValueFormatter'
import { deriveKpiSeries } from '../../lib/kpi'
import { formatSignedPct } from '../../lib/format'
import { targetValueFor } from '../../lib/kpiTargets'
import { Sparkline } from './Sparkline'

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
  /** Matched KPI target (authed surfaces only) → pacing row. */
  target?: KPITarget | null
}

export function KPICard({ data, config, target }: Props) {
  const { t } = useTranslation()
  const fmtVal = useChartValueFormatter(config.format)
  const series = deriveKpiSeries(data, config)
  // Use the SAME resolved column as the series so label/value/target agree.
  const key = series.yKey ?? config.y_axis ?? Object.keys(data[0] ?? {})[0]
  const raw = key ? (data[0] ?? {})[key] : '—'

  const isNumber = series.latest != null
  const animated = useCountUp(isNumber ? series.latest! : NaN)
  const display = isNumber ? fmtVal(animated, { compact: false }) : String(raw ?? '—')

  // Pacing vs a saved target — same scale gate as the chart target lines so a
  // bad title match can't render nonsense percentages. Compares the CHART's
  // latest value (fresh) against the backend's expected-by-now pacing value.
  // targetValueFor guards the DATA side; target_value === 0 is guarded here.
  // Known limit: this assumes the target period matches the series period
  // (month target × monthly series); grossly mismatched periods are already
  // suppressed by the 3× scale gate.
  const targetValue = target ? targetValueFor(target, data, key, config.x_axis) : undefined
  const pacing =
    target && targetValue !== undefined && isNumber && targetValue !== 0
      ? {
          attainmentPct: Math.round((series.latest! / targetValue) * 100),
          onTrack: series.latest! >= target.pacing.expected_value,
        }
      : null

  // Icon, sign and tone all derive from the SAME 1-decimal rounding that
  // formatSignedPct applies, so a −0.02% delta can't pair a down arrow with
  // a "+0%" label. −0 rounds to a neutral flat chip with an up glyph.
  const delta = series.deltaPct
  const rounded = delta == null ? null : Math.round(delta * 10) / 10
  const deltaTone =
    rounded == null || rounded === 0
      ? 'text-ink-soft'
      : rounded > 0
        ? 'text-accent'
        : 'text-[#D87C6B]'

  return (
    <div className="plot-grid relative flex flex-col items-start justify-center rounded-2xl border border-line bg-surface-2 p-10">
      <span className="eyebrow">{config.y_label ?? key}</span>
      <span className="mt-2 font-display text-6xl font-bold leading-none text-ink tabular-nums">
        {display}
      </span>
      {/* Sparkline only ever accompanies the delta text — a trend conveyed
          solely by an aria-hidden decoration would be invisible to AT. */}
      {delta != null && rounded != null && (
        <div className="mt-3 flex items-center gap-3">
          <span className={`flex items-center gap-1 text-sm font-medium tabular-nums ${deltaTone}`}>
            {rounded >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
            {formatSignedPct(delta)}
            <span className="font-normal text-ink-faint">{t('kpi.vsPrevious')}</span>
          </span>
          <Sparkline points={series.points} trend={rounded != null && rounded < 0 ? 'down' : 'up'} />
        </div>
      )}
      {pacing && (
        <div className="mt-3 flex items-center gap-2 text-xs text-ink-soft">
          <span>
            {t('chart.target')}: <span className="tabular-nums">{fmtVal(targetValue!, { compact: false })}</span>
          </span>
          <span className="tabular-nums">· {pacing.attainmentPct}%</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              pacing.onTrack ? 'bg-accent-soft text-accent' : 'bg-surface text-[#D87C6B]'
            }`}
          >
            {pacing.onTrack ? t('kpi.onTrack') : t('kpi.behind')}
          </span>
        </div>
      )}
      <span className="absolute right-6 top-6 h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent))]" />
    </div>
  )
}
