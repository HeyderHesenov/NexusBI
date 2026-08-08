import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartConfig } from '../../types'
import { useChartValueFormatter } from '../../hooks/useChartValueFormatter'
import { collapseByX, sortByX } from '../../lib/series'
import { timeSeriesXAxisProps, tooltipStyleProps, valueYAxisProps } from './axis'
import { targetLineProps } from './targetLine'
import { useMultiSeries } from './useMultiSeries'
import { useChartTheme } from './theme'

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
  height?: number | string
  /** Matched KPI target — renders a dashed reference line when set. */
  targetValue?: number
}

export function AreaChartWidget({ data, config, height = 320, targetValue }: Props) {
  const { t } = useTranslation()
  const fmtVal = useChartValueFormatter(config.format)
  const { SERIES, ACCENT, AXIS, GRID, INK_SOFT, tooltipItem, tooltipLabel, tooltipStyle } =
    useChartTheme()
  const x = config.x_axis ?? Object.keys(data[0] ?? {})[0]
  const y = config.y_axis ?? Object.keys(data[0] ?? {})[1]
  const gid = `nx-area-${useId()}`

  const multi = useMultiSeries(data, x, y, config)
  // Collapse duplicate-x rows into one point per x, then order a time/numeric
  // axis chronologically (recharts plots rows in array order).
  const rows = multi ? sortByX(multi.rows, x) : sortByX(collapseByX(data, x, y), x)
  const longX = rows.some((d) => String(d[x] ?? '').length > 10)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: config.x_label ? 16 : 0, left: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
        <XAxis {...timeSeriesXAxisProps({ axis: AXIS, inkSoft: INK_SOFT }, x, config.x_label, longX)} />
        <YAxis {...valueYAxisProps({ axis: AXIS, inkSoft: INK_SOFT }, fmtVal, config.y_label)} />
        <Tooltip
          {...tooltipStyleProps(tooltipStyle, tooltipLabel, tooltipItem)}
          formatter={(value: number | string) => fmtVal(Number(value))}
        />
        {multi ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        {Number.isFinite(targetValue) ? (
          <ReferenceLine y={targetValue} {...targetLineProps(t('chart.target'), INK_SOFT)} />
        ) : null}
        {multi ? (
          multi.series.map((s, i) => (
            <Area
              key={s}
              type="monotone"
              dataKey={s}
              stroke={SERIES[i % SERIES.length]}
              strokeWidth={2}
              fill={SERIES[i % SERIES.length]}
              fillOpacity={0.08}
              dot={false}
              activeDot={{ r: 4, fill: SERIES[i % SERIES.length] }}
            />
          ))
        ) : (
          <Area
            type="monotone"
            dataKey={y}
            name={config.y_label ?? y}
            stroke={ACCENT}
            strokeWidth={2.5}
            fill={`url(#${gid})`}
            dot={false}
            activeDot={{ r: 5, fill: ACCENT }}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  )
}
