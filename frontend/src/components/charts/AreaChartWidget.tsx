import { useId } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartConfig } from '../../types'
import { useFormatNumber } from '../../hooks/useFormatNumber'
import { TruncatedTick } from './axis'
import { useChartTheme } from './theme'

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
  height?: number | string
}

export function AreaChartWidget({ data, config, height = 320 }: Props) {
  const fmtNum = useFormatNumber()
  const { ACCENT, AXIS, GRID, tooltipItem, tooltipLabel, tooltipStyle } = useChartTheme()
  const x = config.x_axis ?? Object.keys(data[0] ?? {})[0]
  const y = config.y_axis ?? Object.keys(data[0] ?? {})[1]
  const gid = `nx-area-${useId()}`
  const longX = data.some((d) => String(d[x] ?? '').length > 10)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
        <XAxis
          dataKey={x}
          stroke={AXIS}
          tickLine={false}
          tick={longX ? <TruncatedTick max={10} anchor="middle" /> : { fontSize: 12, fill: AXIS }}
        />
        <YAxis
          stroke={AXIS}
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => fmtNum(Number(v), { compact: true })}
        />
        <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabel} itemStyle={tooltipItem} />
        <Area
          type="monotone"
          dataKey={y}
          stroke={ACCENT}
          strokeWidth={2.5}
          fill={`url(#${gid})`}
          dot={false}
          activeDot={{ r: 5, fill: ACCENT }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
