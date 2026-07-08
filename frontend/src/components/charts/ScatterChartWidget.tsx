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

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} />
        <XAxis
          type="number"
          dataKey={x}
          name={x}
          stroke={AXIS}
          fontSize={12}
          tickLine={false}
          tickFormatter={(v) => fmtNum(Number(v), { compact: true })}
        />
        <YAxis
          type="number"
          dataKey={y}
          name={y}
          stroke={AXIS}
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => fmtNum(Number(v), { compact: true })}
        />
        <ZAxis range={[60, 60]} />
        <Tooltip
          cursor={{ strokeDasharray: '3 3', stroke: GRID }}
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabel}
          itemStyle={tooltipItem}
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
