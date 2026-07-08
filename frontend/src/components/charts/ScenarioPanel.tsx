import { useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Crosshair, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ChartRenderer } from './LazyChartRenderer'
import { useChartTheme } from './theme'
import { useFormatNumber } from '../../hooks/useFormatNumber'
import * as scenarioApi from '../../api/scenario'
import type { GoalSeekResult, MonteCarloResult } from '../../api/scenario'
import type { ChartConfig } from '../../types'

interface Props {
  data: Record<string, unknown>[]
  valueCol: string | null
  queryLogId?: string | null
}

/** What-if + goal-seek + Monte Carlo scenario planning for a result series. */
export function ScenarioPanel({ data, valueCol, queryLogId }: Props) {
  const { t } = useTranslation()
  const fmtNum = useFormatNumber()
  const theme = useChartTheme()
  const [pct, setPct] = useState('10')
  const [goal, setGoal] = useState('')
  const [goalSeek, setGoalSeek] = useState<GoalSeekResult | null>(null)
  const [mc, setMc] = useState<MonteCarloResult | null>(null)
  const [busy, setBusy] = useState(false)

  const { actual, projected } = useMemo(() => {
    if (!valueCol) return { actual: 0, projected: 0 }
    const sum = data.reduce((s, r) => s + (Number(r[valueCol]) || 0), 0)
    const factor = 1 + (Number(pct) || 0) / 100
    return { actual: sum, projected: sum * factor }
  }, [data, valueCol, pct])

  if (!valueCol) {
    return (
      <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink-faint">
        {t('scenarioPanel.noNumericColumn')}
      </div>
    )
  }

  const delta = projected - actual
  const compareData = [
    { ssenari: t('scenarioPanel.actual'), dəyər: Math.round(actual * 100) / 100 },
    { ssenari: t('scenarioPanel.scenario'), dəyər: Math.round(projected * 100) / 100 },
  ]
  const compareConfig = {
    chart_type: 'bar', x_axis: 'ssenari', y_axis: 'dəyər', color_by: null,
  } as ChartConfig

  const runGoalSeek = async () => {
    if (!queryLogId || !goal) return
    try {
      setGoalSeek(await scenarioApi.goalSeek(queryLogId, Number(goal)))
    } catch {
      /* interceptor toast */
    }
  }

  const runMonteCarlo = async () => {
    if (!queryLogId || busy) return
    setBusy(true)
    try {
      setMc(await scenarioApi.monteCarlo(queryLogId, 6, 1000))
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  // Stack p10 + (p90-p10) so the upper Area renders as a band above p10.
  const fan = (mc?.bands ?? []).map((b) => ({
    period: `+${b.period}`,
    p10: b.p10,
    p90: b.p90,
    band: Math.max(0, b.p90 - b.p10),
    p50: b.p50,
  }))

  // Show readable P10–P90 / P50 in the tooltip, hiding the stacking artifacts.
  const fanTooltip = (value: number, name: string, props: { payload?: typeof fan[number] }) => {
    const row = props.payload
    if (name === 'p50') return [fmtNum(value), 'P50']
    if (name === 'band' && row) return [`${fmtNum(row.p10)} – ${fmtNum(row.p90)}`, 'P10–P90']
    return null
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={15} className="text-accent" />
          <span className="eyebrow text-ink-soft">What-if · {valueCol}</span>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          {t('scenarioPanel.change')}
          <input
            type="number"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className="w-20 rounded-lg border border-line bg-surface px-2 py-1 text-ink focus:border-accent focus:outline-none"
          />
          %
        </label>
        <span className="font-mono text-xs text-ink-faint">
          {fmtNum(actual)} → <span className="text-ink">{fmtNum(projected)}</span>{' '}
          <span className={delta >= 0 ? 'text-accent' : 'text-[#D87C6B]'}>
            ({delta >= 0 ? '+' : ''}{fmtNum(delta)})
          </span>
        </span>
      </div>
      <ChartRenderer data={compareData} config={compareConfig} height={180} />

      {queryLogId && (
        <div className="space-y-3 border-t border-line pt-3">
          {/* Goal-seek */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm text-ink-soft">
              <Crosshair size={14} className="text-accent" /> {t('scenarioPanel.goalSeek')}
            </span>
            <input
              type="number"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={t('scenarioPanel.targetValuePlaceholder')}
              className="w-32 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
            <button
              onClick={runGoalSeek}
              className="rounded-lg border border-accent/40 bg-accent-soft px-2.5 py-1 text-sm font-semibold text-accent transition hover:border-accent"
            >
              {t('scenarioPanel.calculate')}
            </button>
            {goalSeek && (
              <span className="font-mono text-xs text-ink-soft">
                {t('scenarioPanel.current')} {fmtNum(goalSeek.current)} → {t('scenarioPanel.required')}{' '}
                <span className="text-ink">
                  {goalSeek.required_pct != null ? `${goalSeek.required_pct}%` : '—'}
                </span>
              </span>
            )}
          </div>

          {/* Monte Carlo */}
          <div>
            <button
              onClick={runMonteCarlo}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-2.5 py-1 text-sm font-semibold text-accent transition hover:border-accent disabled:opacity-60"
            >
              <Sparkles size={14} className={busy ? 'animate-pulse' : ''} />
              {busy ? t('scenarioPanel.simulating') : t('scenarioPanel.monteCarloForecast')}
            </button>
            {mc && (
              <div className="mt-2">
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                  {t('scenarioPanel.rangeMeanReturn', { pct: mc.mean_return_pct })}
                </p>
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={fan} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={theme.GRID} vertical={false} />
                    <XAxis dataKey="period" tick={{ fill: theme.AXIS, fontSize: 11 }} />
                    <YAxis tick={{ fill: theme.AXIS, fontSize: 11 }} width={48} />
                    <Tooltip contentStyle={theme.tooltipStyle} formatter={fanTooltip} />
                    <Area type="monotone" dataKey="p10" stackId="band" stroke="none" fill="transparent" />
                    <Area
                      type="monotone"
                      dataKey="band"
                      stackId="band"
                      stroke="none"
                      fill={theme.ACCENT}
                      fillOpacity={0.15}
                    />
                    <Line type="monotone" dataKey="p50" stroke={theme.ACCENT} strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
