import type { ChartConfig } from '../../types'
import { useCountUp } from '../../hooks/useCountUp'
import { useFormatNumber } from '../../hooks/useFormatNumber'

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
}

export function KPICard({ data, config }: Props) {
  const fmtNum = useFormatNumber()
  const row = data[0] ?? {}
  const key = config.y_axis ?? Object.keys(row)[0]
  const raw = key ? row[key] : '—'
  const numeric = typeof raw === 'number' ? raw : Number(raw)
  const isNumber = Number.isFinite(numeric) && raw !== '' && raw !== null
  const animated = useCountUp(isNumber ? numeric : NaN)
  const display = isNumber
    ? fmtNum(animated, { ...(config.format?.currency ? { currency: config.format.currency } : {}), decimals: config.format?.decimals ?? 2 })
    : String(raw)

  return (
    <div className="plot-grid relative flex flex-col items-start justify-center rounded-2xl border border-line bg-surface-2 p-10">
      <span className="eyebrow">{key}</span>
      <span className="mt-2 font-display text-6xl font-bold leading-none text-ink tabular-nums">
        {display}
      </span>
      <span className="absolute right-6 top-6 h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent))]" />
    </div>
  )
}
