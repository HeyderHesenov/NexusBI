import {
  AreaChart as AreaIcon,
  BarChart3,
  LineChart as LineIcon,
  PieChart as PieIcon,
  ScatterChart as ScatterIcon,
  Table as TableIcon,
  Grid3x3 as PivotIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChartType } from '../../types'

const OPTIONS: { type: ChartType; labelKey: string; Icon: typeof BarChart3 }[] = [
  { type: 'bar', labelKey: 'chartToolbar.bar', Icon: BarChart3 },
  { type: 'line', labelKey: 'chartToolbar.line', Icon: LineIcon },
  { type: 'area', labelKey: 'chartToolbar.area', Icon: AreaIcon },
  { type: 'pie', labelKey: 'chartToolbar.pie', Icon: PieIcon },
  { type: 'scatter', labelKey: 'chartToolbar.scatter', Icon: ScatterIcon },
  { type: 'table', labelKey: 'chartToolbar.table', Icon: TableIcon },
  { type: 'pivot', labelKey: 'chartToolbar.pivot', Icon: PivotIcon },
]

/** Shared base for small chart control buttons (toolbar + ChartView actions). */
export const CHART_BTN =
  'flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors duration-200'

interface Props {
  value: ChartType
  onChange: (type: ChartType) => void
}

export function ChartToolbar({ value, onChange }: Props) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-surface-2 p-1">
      {OPTIONS.map(({ type, labelKey, Icon }) => {
        const active = value === type
        const label = t(labelKey)
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
