import {
  AreaChart as AreaIcon,
  BarChart3,
  LineChart as LineIcon,
  PieChart as PieIcon,
  ScatterChart as ScatterIcon,
  Table as TableIcon,
  Grid3x3 as PivotIcon,
} from 'lucide-react'
import type { ChartType } from '../../types'

/** Chart-type options (shared by the ChartToolbar selector). */
export const OPTIONS: { type: ChartType; labelKey: string; Icon: typeof BarChart3 }[] = [
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
