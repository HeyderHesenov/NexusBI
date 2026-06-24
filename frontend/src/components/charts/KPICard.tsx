import type { ChartConfig } from '../../types'

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
}

export function KPICard({ data, config }: Props) {
  const row = data[0] ?? {}
  const key = config.y_axis ?? Object.keys(row)[0]
  const value = key ? row[key] : '—'
  return (
    <div className="plot-grid relative flex flex-col items-start justify-center rounded-2xl border border-grid bg-panel p-10">
      <span className="eyebrow">{key}</span>
      <span className="mt-2 font-display text-6xl font-bold leading-none text-brand">
        {String(value)}
      </span>
      <span className="absolute right-6 top-6 h-2 w-2 rounded-full bg-signal" />
    </div>
  )
}
