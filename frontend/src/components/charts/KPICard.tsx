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
    <div className="flex flex-col items-center justify-center rounded-xl bg-slate-800 p-8">
      <span className="text-sm uppercase tracking-wide text-slate-400">{key}</span>
      <span className="mt-2 text-4xl font-bold text-brand">{String(value)}</span>
    </div>
  )
}
