import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers } from 'lucide-react'
import { formatMetricValue as fmt, formatSignedPct, truncateLabel } from '../../lib/format'
import { compareScenarios } from '../../lib/twinAnalysis'
import { DANGER, useChartTheme } from '../charts/theme'
import type { TwinScenario } from '../../store/twinStore'
import type { EvaluatedNode } from '../../types'

interface Props {
  root: EvaluatedNode
  baseline: number
  scenarios: TwinScenario[]
}

const W = 640
const BAR_H = 30
const ROW_GAP = 16
const LABEL_W = 150
const VALUE_GUTTER = 90

/** Baseline vs every saved scenario — ranked bars plus a delta table. */
export function ScenarioCompare({ root, baseline, scenarios }: Props) {
  const { t } = useTranslation()
  const theme = useChartTheme()

  const rows = useMemo(() => {
    const scenarioRows = compareScenarios(root, scenarios, baseline).map((r) => ({
      id: r.id,
      name: r.name,
      value: r.value,
      delta: r.delta,
      deltaPct: r.deltaPct,
      isBaseline: false,
    }))
    return [
      { id: '__baseline', name: t('twinPage.baseline'), value: baseline, delta: 0, deltaPct: 0, isBaseline: true },
      ...scenarioRows,
    ].sort((a, b) => b.value - a.value)
  }, [root, scenarios, baseline, t])

  if (!scenarios.length) {
    return (
      <div className="grid min-h-[40vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
        <div>
          <Layers size={22} className="mx-auto text-ink-faint" />
          <p className="mt-3 font-display text-lg text-ink">{t('twinPage.compare.emptyTitle')}</p>
          <p className="mt-1 text-sm text-ink-soft">{t('twinPage.compare.emptyBody')}</p>
        </div>
      </div>
    )
  }

  const values = rows.map((r) => r.value).concat(0)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const plotW = W - LABEL_W - VALUE_GUTTER
  const x = (v: number) => LABEL_W + ((v - min) / span) * plotW
  const height = rows.length * (BAR_H + ROW_GAP)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-line bg-surface p-5">
        <p className="eyebrow mb-3">{t('twinPage.compare.chart')}</p>
        <svg viewBox={`0 0 ${W} ${height}`} className="w-full text-ink" role="img" aria-label={t('twinPage.compare.chart')}>
          {rows.map((r, i) => {
            const y = i * (BAR_H + ROW_GAP)
            const x0 = Math.min(x(0), x(r.value))
            const w = Math.max(Math.abs(x(r.value) - x(0)), 2)
            const fill = r.isBaseline ? theme.SERIES[5] : r.delta >= 0 ? theme.ACCENT : DANGER
            return (
              <g key={r.id}>
                <text x={0} y={y + BAR_H / 2 + 4} fontSize={12} fill="currentColor">
                  {truncateLabel(r.name)}
                </text>
                <rect x={x0} y={y} width={w} height={BAR_H} rx={6} fill={fill} opacity={r.isBaseline ? 0.7 : 1} />
                <text x={x0 + w + 6} y={y + BAR_H / 2 + 4} fontSize={11} fill={theme.AXIS} className="font-mono">
                  {fmt(r.value)}
                </text>
              </g>
            )
          })}
          <line x1={x(0)} y1={0} x2={x(0)} y2={height} stroke={theme.GRID} strokeDasharray="3 3" />
        </svg>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <p className="eyebrow mb-3">{t('twinPage.compare.table')}</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-faint">
              <th className="pb-2 font-medium">{t('twinPage.compare.scenario')}</th>
              <th className="pb-2 text-right font-medium">{t('twinPage.result')}</th>
              <th className="pb-2 text-right font-medium">{t('twinPage.compare.vsBaseline')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line/60 last:border-0">
                <td className="py-2 text-ink">{r.name}</td>
                <td className="py-2 text-right font-mono text-ink">{fmt(r.value)}</td>
                <td className="py-2 text-right font-mono">
                  {r.isBaseline ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    <span className={r.delta >= 0 ? 'text-accent' : 'text-[#D87C6B]'}>
                      {r.delta >= 0 ? '+' : ''}
                      {fmt(r.delta)}
                      {r.deltaPct !== null && ` (${formatSignedPct(r.deltaPct)})`}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
