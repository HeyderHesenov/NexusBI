import { useTranslation } from 'react-i18next'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartConfig } from '../../types'
import { useChartValueFormatter } from '../../hooks/useChartValueFormatter'
import { TruncatedTick } from './axis'
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

export function LineChartWidget({ data, config, height = 320, targetValue }: Props) {
  const { t } = useTranslation()
  const fmtVal = useChartValueFormatter(config.format)
  const { SERIES, ACCENT, AXIS, GRID, INK_SOFT, tooltipItem, tooltipLabel, tooltipStyle } =
    useChartTheme()
  const x = config.x_axis ?? Object.keys(data[0] ?? {})[0]
  const y = config.y_axis ?? Object.keys(data[0] ?? {})[1]

  const multi = useMultiSeries(data, x, y, config)
  const rows = multi ? multi.rows : data
  const longX = rows.some((d) => String(d[x] ?? '').length > 10)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 8, bottom: config.x_label ? 16 : 0, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
        <XAxis
          dataKey={x}
          stroke={AXIS}
          tickLine={false}
          tick={longX ? <TruncatedTick max={10} anchor="middle" /> : { fontSize: 12, fill: AXIS }}
          label={
            config.x_label
              ? { value: config.x_label, position: 'insideBottom', offset: -12, fontSize: 11, fill: AXIS }
              : undefined
          }
        />
        <YAxis
          stroke={AXIS}
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => fmtVal(Number(v))}
          label={
            config.y_label
              ? { value: config.y_label, angle: -90, position: 'insideLeft', fontSize: 11, fill: AXIS }
              : undefined
          }
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabel}
          itemStyle={tooltipItem}
          formatter={(value: number | string) => fmtVal(Number(value))}
        />
        {multi ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        {Number.isFinite(targetValue) ? (
          <ReferenceLine y={targetValue} {...targetLineProps(t('chart.target'), INK_SOFT)} />
        ) : null}
        {multi ? (
          multi.series.map((s, i) => (
            <Line
              key={s}
              type="monotone"
              dataKey={s}
              stroke={SERIES[i % SERIES.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: SERIES[i % SERIES.length] }}
            />
          ))
        ) : (
          <Line
            type="monotone"
            dataKey={y}
            name={config.y_label ?? y}
            stroke={ACCENT}
            strokeWidth={2.5}
            dot={{ r: 3, fill: ACCENT, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: ACCENT }}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}
