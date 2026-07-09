import {
  CartesianGrid,
  Scatter,
  ScatterChart,
  Tooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import type { ChartConfig } from '../../types'
import { useChartValueFormatter } from '../../hooks/useChartValueFormatter'
import { useFormatNumber } from '../../hooks/useFormatNumber'
import { useChartTheme } from './theme'

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
  height?: number | string
  onPointClick?: (field: string, value: unknown) => void
}

/** Scatter needs two numeric axes; falls back to row index for X when the
 *  configured X column isn't numeric. */
export function ScatterChartWidget({ data, config, height = 320, onPointClick }: Props) {
  const fmtNum = useFormatNumber()
  const { ACCENT, AXIS, GRID, tooltipItem, tooltipLabel, tooltipStyle } = useChartTheme()
  const keys = Object.keys(data[0] ?? {})
  const numeric = keys.filter((k) => typeof data[0]?.[k] === 'number')
  const x = (config.x_axis && numeric.includes(config.x_axis) && config.x_axis) || numeric[0] || keys[0]
  const y =
    (config.y_axis && numeric.includes(config.y_axis) && config.y_axis) ||
    numeric.find((k) => k !== x) ||
    numeric[0] ||
    keys[1]
  // Format/labels describe the CONFIGURED axes; drop them when fallback picked
  // a different column (a mislabeled axis is worse than an unlabeled one).
  const fmtVal = useChartValueFormatter(y === config.y_axis ? config.format : undefined)
  const xLabel = x === config.x_axis ? config.x_label : undefined
  const yLabel = y === config.y_axis ? config.y_label : undefined

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 8, bottom: xLabel ? 18 : 8, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} />
        <XAxis
          type="number"
          dataKey={x}
          name={x}
          stroke={AXIS}
          fontSize={12}
          tickLine={false}
          tickFormatter={(v) => fmtNum(Number(v), { compact: true })}
          label={
            xLabel
              ? { value: xLabel, position: 'insideBottom', offset: -12, fontSize: 11, fill: AXIS }
              : undefined
          }
        />
        <YAxis
          type="number"
          dataKey={y}
          name={y}
          stroke={AXIS}
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => fmtVal(Number(v))}
          label={
            yLabel
              ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: AXIS }
              : undefined
          }
        />
        <ZAxis range={[60, 60]} />
        <Tooltip
          cursor={{ strokeDasharray: '3 3', stroke: GRID }}
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabel}
          itemStyle={tooltipItem}
          formatter={(value: number | string, name: string) =>
            name === y ? fmtVal(Number(value)) : fmtNum(Number(value), { compact: true })
          }
        />
        <Scatter
          data={data}
          fill={ACCENT}
          fillOpacity={0.75}
          className={onPointClick ? 'cursor-pointer' : undefined}
          onClick={onPointClick ? (e: { [k: string]: unknown }) => onPointClick(x, e?.[x]) : undefined}
        />
      </ScatterChart>
    </ResponsiveContainer>
  )
}
