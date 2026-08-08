import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useTranslation } from 'react-i18next'
import type { DecisionTrajectory } from '../../types'
import { useFormatNumber } from '../../hooks/useFormatNumber'
import { useFormatDate } from '../../hooks/useFormatDate'
import { trajectoryRows, type TrajectoryRow } from '../../lib/trajectory'
import { axisTickProps } from '../charts/axis'
import { useChartTheme } from '../charts/theme'

interface Props {
  trajectory: DecisionTrajectory
  baseline: number | null
  height?: number
}

/** Realized metric (solid) vs the counterfactual projection (dashed) + its band,
 *  with the decision baseline as a reference line. When the counterfactual falls
 *  back to the "baseline" method (no pre-decision history) the band/projection are
 *  simply absent — the parent shows an honest caption instead. */
export function TrajectoryChart({ trajectory, baseline, height = 220 }: Props) {
  const { t } = useTranslation()
  const fmtNum = useFormatNumber()
  // Not `new Date(x).toLocaleString(i18n.language)`: that parses an
  // offset-less stamp as local time (SQLite deployments send those), and
  // i18n.language is an app code, not a BCP-47 locale — it throws RangeError on
  // i18next's 'cimode'. The shared formatter handles both.
  const fmtDate = useFormatDate()
  const { ACCENT, AXIS, GRID, INK_SOFT, tooltipItem, tooltipLabel, tooltipStyle } = useChartTheme()

  const rows = trajectoryRows(trajectory)
  // Only draw the band/projection when a forecast counterfactual exists. Under the
  // "baseline" fallback there is no band, so rendering those series would show
  // empty legend entries for lines that never appear. NOT connecting nulls keeps
  // the band strictly over the post-decision points it actually covers.
  const hasBand = !!trajectory.counterfactual?.band?.length

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
        <XAxis
          dataKey="label"
          stroke={AXIS}
          fontSize={11}
          tickLine={false}
          tick={axisTickProps(INK_SOFT, 11)}
        />
        <YAxis
          stroke={AXIS}
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => fmtNum(Number(v), { compact: true })}
          tick={axisTickProps(INK_SOFT, 11)}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabel}
          itemStyle={tooltipItem}
          // A baseline is read out of the spawning query's stored result without
          // re-running it, so its number can be much older than the tick it sits
          // on. Say so on the point rather than letting the x-axis imply the two
          // are the same; `asOf` is set only when they actually differ.
          labelFormatter={(label, payload) => {
            const asOf = (payload?.[0]?.payload as TrajectoryRow | undefined)?.asOf
            if (!asOf) return label
            return (
              <>
                {label}
                <span className="mt-0.5 block text-[10px] font-normal text-ink-soft">
                  {t('decisionsPage.dataAsOf', { at: fmtDate(asOf, { mode: 'short' }) })}
                </span>
              </>
            )
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: 'rgb(var(--ink-soft))' }} />

        {baseline != null && (
          <ReferenceLine
            y={baseline}
            stroke={INK_SOFT}
            strokeDasharray="4 4"
            label={{ value: t('decisionsPage.baseline'), fontSize: 10, fill: INK_SOFT, position: 'insideTopLeft' }}
          />
        )}

        {hasBand && (
          <>
            {/* Counterfactual band: transparent base + accent-soft span stacked on top. */}
            <Area
              stackId="cf" dataKey="bandBase" stroke="none" fill="transparent"
              legendType="none" name="cf-base" isAnimationActive={false}
            />
            <Area
              stackId="cf" dataKey="bandSpan" stroke="none" fill={ACCENT} fillOpacity={0.14}
              name={t('decisionsPage.counterfactualBand')} isAnimationActive={false}
            />
            <Line
              dataKey="counterfactual" name={t('decisionsPage.counterfactualLine')}
              stroke={INK_SOFT} strokeWidth={2} strokeDasharray="5 5" dot={false}
            />
          </>
        )}

        <Line
          dataKey="realized" name={t('decisionsPage.real')}
          stroke={ACCENT} strokeWidth={2} dot={{ r: 2.5, fill: ACCENT }} connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
