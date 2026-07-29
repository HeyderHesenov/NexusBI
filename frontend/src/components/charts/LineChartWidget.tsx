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
import { collapseByX, sortByX } from '../../lib/series'
import { timeSeriesXAxisProps, tooltipStyleProps, valueYAxisProps } from './axis'
import { targetLineProps } from './targetLine'
import { useMultiSeries } from './useMultiSeries'
import { useChartTheme } from './theme'

/** Above this many points a per-point dot marker just adds noise — draw a clean
 *  line instead (a sparse series keeps its dots as read-off anchors). */
const DENSE_POINTS = 30

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
  // Collapse un-aggregated rows (many sales per date) into one point per x, then
  // order a time/numeric axis chronologically — recharts draws rows in array
  // order, so without this a line zig-zags through un-ordered points.
  const rows = multi ? sortByX(multi.rows, x) : sortByX(collapseByX(data, x, y), x)
  const longX = rows.some((d) => String(d[x] ?? '').length > 10)
  const dense = rows.length > DENSE_POINTS
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 8, bottom: config.x_label ? 16 : 0, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
        <XAxis {...timeSeriesXAxisProps(AXIS, x, config.x_label, longX)} />
        <YAxis {...valueYAxisProps(AXIS, fmtVal, config.y_label)} />
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
            dot={dense ? false : { r: 3, fill: ACCENT, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: ACCENT }}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}
