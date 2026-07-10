import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { useFormatNumber } from '../../hooks/useFormatNumber'
import { useChartTheme } from '../charts/theme'
import type { MLDiagnostics } from '../../types'

type AVP = NonNullable<MLDiagnostics['actual_vs_predicted']>

function histogram(residuals: number[], bins = 13): { mid: number; count: number }[] {
  const min = Math.min(...residuals)
  const max = Math.max(...residuals)
  if (min === max) return [{ mid: min, count: residuals.length }]
  const width = (max - min) / bins
  const buckets = Array.from({ length: bins }, (_, i) => ({ mid: min + width * (i + 0.5), count: 0 }))
  for (const r of residuals) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((r - min) / width)))
    buckets[idx].count += 1
  }
  return buckets
}

/** Two regression truth-tests on the holdout: does predicted track actual (points
 *  hug the ideal diagonal?), and are the errors centered on zero (unbiased)? */
export function RegressionDiagnostics({ avp }: { avp: AVP }) {
  const { t } = useTranslation()
  const fmtNum = useFormatNumber()
  const { ACCENT, AXIS, GRID, tooltipStyle, tooltipItem, tooltipLabel } = useChartTheme()

  // Keep only paired, finite points — a stray NaN would poison Math.min/max and the
  // residual binning (buckets[NaN]) and blank the whole chart.
  const points = useMemo(
    () =>
      avp.actual
        .map((a, i) => ({ actual: a, predicted: avp.predicted[i] }))
        .filter((p) => Number.isFinite(p.actual) && Number.isFinite(p.predicted)),
    [avp],
  )
  const residuals = useMemo(() => points.map((p) => p.actual - p.predicted), [points])
  const bins = useMemo(() => histogram(residuals), [residuals])
  const domain = useMemo(() => {
    const all = points.flatMap((p) => [p.actual, p.predicted])
    return [Math.min(...all), Math.max(...all)] as [number, number]
  }, [points])

  const tick = (v: number) => fmtNum(v, { compact: true })

  if (!points.length) return null

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow mb-2">{t('automl.avpTitle')}</p>
        <ResponsiveContainer width="100%" height={280}>
          <ScatterChart margin={{ top: 8, right: 12, bottom: 20, left: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke={GRID} />
            <XAxis
              type="number"
              dataKey="actual"
              name={t('automl.avpActual')}
              domain={domain}
              stroke={AXIS}
              fontSize={11}
              tickLine={false}
              tickFormatter={tick}
              label={{ value: t('automl.avpActual'), position: 'insideBottom', offset: -12, fontSize: 11, fill: AXIS }}
            />
            <YAxis
              type="number"
              dataKey="predicted"
              name={t('automl.avpPredicted')}
              domain={domain}
              stroke={AXIS}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={tick}
              label={{ value: t('automl.avpPredicted'), angle: -90, position: 'insideLeft', fontSize: 11, fill: AXIS }}
            />
            <ZAxis range={[36, 36]} />
            {/* Ideal: predicted == actual. Points on this line are perfect. */}
            <ReferenceLine
              segment={[
                { x: domain[0], y: domain[0] },
                { x: domain[1], y: domain[1] },
              ]}
              stroke={AXIS}
              strokeDasharray="4 4"
              ifOverflow="hidden"
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3', stroke: GRID }}
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabel}
              itemStyle={tooltipItem}
              formatter={(v: number | string) => fmtNum(Number(v))}
            />
            <Scatter data={points} fill={ACCENT} fillOpacity={0.7} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <div>
        <p className="eyebrow mb-2">{t('automl.residualTitle')}</p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={bins} margin={{ top: 8, right: 12, bottom: 20, left: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
            <XAxis
              type="number"
              dataKey="mid"
              stroke={AXIS}
              fontSize={11}
              tickLine={false}
              tickFormatter={tick}
              label={{ value: t('automl.residualAxis'), position: 'insideBottom', offset: -12, fontSize: 11, fill: AXIS }}
            />
            <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
            <ReferenceLine x={0} stroke={AXIS} strokeDasharray="4 4" />
            <Tooltip
              cursor={{ fill: GRID, fillOpacity: 0.25 }}
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabel}
              itemStyle={tooltipItem}
              formatter={(v: number | string) => String(v)}
              labelFormatter={(v: number | string) => fmtNum(Number(v))}
            />
            <Bar dataKey="count" fill={ACCENT} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
