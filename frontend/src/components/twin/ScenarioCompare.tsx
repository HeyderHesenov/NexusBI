import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers } from 'lucide-react'
import { formatMetricValue as fmt, formatSignedPct, truncateLabel } from '../../lib/format'
import { compareScenarios } from '../../lib/twinAnalysis'
import { DANGER, useChartTheme } from '../charts/theme'
import { ChartTip, niceTicks, useChartHover, useMounted } from './chartkit'
import type { TwinScenario } from '../../store/twinStore'
import type { EvaluatedNode } from '../../types'

interface Props {
  root: EvaluatedNode
  baseline: number
  scenarios: TwinScenario[]
}

const W = 600
const LABEL_W = 140
const PAD_R = 68
const ROW = 34
const BAR_H = 22
const AXIS_H = 24

/** Baseline vs every saved scenario — ranked animated bars + a delta table. */
export function ScenarioCompare({ root, baseline, scenarios }: Props) {
  const { t } = useTranslation()
  const theme = useChartTheme()
  const mounted = useMounted()
  const { ref, tip, move, clear } = useChartHover()

  const rows = useMemo(() => {
    const scenarioRows = compareScenarios(root, scenarios, baseline).map((r) => ({
      id: r.id, name: r.name, value: r.value, delta: r.delta, deltaPct: r.deltaPct, isBaseline: false,
    }))
    return [
      { id: '__baseline', name: t('twinPage.baseline'), value: baseline, delta: 0, deltaPct: 0, isBaseline: true },
      ...scenarioRows,
    ].sort((a, b) => b.value - a.value)
  }, [root, scenarios, baseline, t])

  if (!scenarios.length) {
    return (
      <div className="plot-grid grid min-h-[220px] place-items-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
        <div>
          <Layers size={22} className="mx-auto text-ink-faint" />
          <p className="mt-3 font-display text-lg text-ink">{t('twinPage.compare.emptyTitle')}</p>
          <p className="mt-1 text-sm text-ink-soft">{t('twinPage.compare.emptyBody')}</p>
        </div>
      </div>
    )
  }

  const values = rows.map((r) => r.value)
  const dmin = Math.min(0, ...values)
  const dmax = Math.max(0, ...values)
  const plotW = W - LABEL_W - PAD_R
  const x = (v: number) => LABEL_W + ((v - dmin) / (dmax - dmin || 1)) * plotW
  const rowsH = rows.length * ROW
  const H = rowsH + AXIS_H
  const ticks = niceTicks(dmin, dmax, 4)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <p className="eyebrow mb-3">{t('twinPage.compare.chart')}</p>
        <div ref={ref} className="relative w-full" onMouseLeave={clear}>
          <ChartTip tip={tip} />
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t('twinPage.compare.chart')}>
            {ticks.map((tk) => (
              <g key={tk}>
                <line x1={x(tk)} y1={0} x2={x(tk)} y2={rowsH} stroke={theme.GRID} strokeDasharray="2 4" />
                <text x={x(tk)} y={H - 6} fontSize={10} textAnchor="middle" fill={theme.AXIS} className="font-mono">{fmt(tk)}</text>
              </g>
            ))}
            {rows.map((r, i) => {
              const y = i * ROW + (ROW - BAR_H) / 2
              const x0 = Math.min(x(0), x(r.value))
              const w = Math.max(Math.abs(x(r.value) - x(0)), 2)
              const fill = r.isBaseline ? theme.SERIES[5] : r.delta >= 0 ? theme.ACCENT : DANGER
              return (
                <g
                  key={r.id}
                  onMouseMove={(e) => move(e, (
                    <span><b>{r.name}</b> · <span className="font-mono">{fmt(r.value)}</span>
                      {!r.isBaseline && r.deltaPct !== null && <span className="font-mono"> ({formatSignedPct(r.deltaPct)})</span>}
                    </span>
                  ))}
                >
                  <text x={0} y={y + BAR_H / 2 + 4} fontSize={12} fill="currentColor" className="text-ink">{truncateLabel(r.name, 18)}</text>
                  <rect
                    x={x0} y={y} width={w} height={BAR_H} rx={5} fill={fill} opacity={r.isBaseline ? 0.8 : 1}
                    style={{
                      transformBox: 'fill-box', transformOrigin: 'left center',
                      transform: mounted ? 'scaleX(1)' : 'scaleX(0)',
                      transition: `transform .5s cubic-bezier(.22,.61,.36,1) ${i * 45}ms`,
                    }}
                  />
                  <text x={x0 + w + 6} y={y + BAR_H / 2 + 4} fontSize={11} fill={theme.AXIS} className="font-mono">{fmt(r.value)}</text>
                </g>
              )
            })}
          </svg>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
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
                    <span style={r.delta >= 0 ? { color: theme.ACCENT } : { color: DANGER }}>
                      {r.delta >= 0 ? '+' : ''}{fmt(r.delta)}
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
