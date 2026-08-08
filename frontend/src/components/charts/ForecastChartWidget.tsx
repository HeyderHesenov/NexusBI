import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useTranslation } from 'react-i18next'
import type { ForecastResult } from '../../types'
import { useFormatNumber } from '../../hooks/useFormatNumber'
import { axisTickProps, tooltipStyleProps } from './axis'
import { useChartTheme } from './theme'

interface Props {
  result: ForecastResult
  height?: number | string
}

/** Historical series (solid) + forecast (dashed) with an 80% confidence band. */
export function ForecastChartWidget({ result, height = 320 }: Props) {
  const { t } = useTranslation()
  const fmtNum = useFormatNumber()
  const { ACCENT, AXIS, GRID, INK_SOFT, tooltipItem, tooltipLabel, tooltipStyle } = useChartTheme()
  const { history, forecast, label_col, value_col } = result

  const hist = history.map((row) => ({
    label: String(row[label_col]),
    actual: Number(row[value_col]),
  }))

  const fc = forecast.map((p) => ({
    label: p.label,
    forecast: p.value ?? undefined,
    bandBase: p.lower ?? undefined,
    bandSpan: p.lower != null && p.upper != null ? p.upper - p.lower : undefined,
  }))

  const combined: Record<string, number | string | undefined>[] = [...hist, ...fc]
  // Bridge the solid and dashed lines at the junction point.
  if (hist.length) {
    combined[hist.length - 1] = { ...combined[hist.length - 1], forecast: hist[hist.length - 1].actual }
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={combined} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
        <XAxis
          dataKey="label"
          stroke={AXIS}
          fontSize={12}
          tickLine={false}
          tick={axisTickProps(INK_SOFT)}
        />
        <YAxis
          stroke={AXIS}
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => fmtNum(Number(v), { compact: true })}
          tick={axisTickProps(INK_SOFT)}
        />
        <Tooltip {...tooltipStyleProps(tooltipStyle, tooltipLabel, tooltipItem)} />
        <Legend wrapperStyle={{ fontSize: 12, color: 'rgb(var(--ink-soft))' }} />

        {/* Confidence band: transparent base + accent-soft span stacked on top. */}
        <Area
          stackId="band"
          dataKey="bandBase"
          stroke="none"
          fill="transparent"
          legendType="none"
          name="band-base"
          isAnimationActive={false}
        />
        <Area
          stackId="band"
          dataKey="bandSpan"
          stroke="none"
          fill={ACCENT}
          // 0.096, not the 0.16 the old `rgb(var(--accent) / 0.16)` spelled,
          // because recharts' Area defaults fillOpacity to 0.6 and MULTIPLIES it
          // into the fill's own alpha (lib/cartesian/Area.js:405). The band
          // shipped at 0.16 × 0.6; passing 0.16 here would have made it 1.67×
          // more opaque than it has ever been — a colour-mechanism change that
          // quietly restyled the chart.
          fillOpacity={0.096}
          name={t('forecastChartWidget.confidenceInterval')}
          isAnimationActive={false}
        />

        <Line
          dataKey="actual"
          name={t('forecastChartWidget.historical')}
          stroke={ACCENT}
          strokeWidth={2}
          dot={false}
          connectNulls
        />
        <Line
          dataKey="forecast"
          name={t('forecastChartWidget.forecast')}
          stroke={ACCENT}
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={{ r: 3, fill: ACCENT }}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
