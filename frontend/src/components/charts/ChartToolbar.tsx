import {
  AreaChart as AreaIcon,
  BarChart3,
  LineChart as LineIcon,
  PieChart as PieIcon,
  ScatterChart as ScatterIcon,
  Table as TableIcon,
} from 'lucide-react'
import type { ChartType } from '../../types'

const OPTIONS: { type: ChartType; label: string; Icon: typeof BarChart3 }[] = [
  { type: 'bar', label: 'Sütun', Icon: BarChart3 },
  { type: 'line', label: 'Xətt', Icon: LineIcon },
  { type: 'area', label: 'Sahə', Icon: AreaIcon },
  { type: 'pie', label: 'Dairə', Icon: PieIcon },
  { type: 'scatter', label: 'Səpələnmə', Icon: ScatterIcon },
  { type: 'table', label: 'Cədvəl', Icon: TableIcon },
]

/** Shared base for small chart control buttons (toolbar + ChartView actions). */
export const CHART_BTN =
  'flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors duration-200'

interface Props {
  value: ChartType
  onChange: (type: ChartType) => void
}

export function ChartToolbar({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-surface-2 p-1">
      {OPTIONS.map(({ type, label, Icon }) => {
        const active = value === type
        return (
          <button
            key={type}
            onClick={() => onChange(type)}
            aria-label={label}
            aria-pressed={active}
            title={label}
            className={`${CHART_BTN} ${
              active ? 'bg-accent text-bg' : 'text-ink-soft hover:bg-surface hover:text-ink'
            }`}
          >
            <Icon size={14} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
