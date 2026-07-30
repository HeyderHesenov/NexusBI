import { Download, FileCode2, FileSpreadsheet, Image as ImageIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import {
  downloadChartPng,
  downloadChartSvg,
  exportFilename,
  findChartSvg,
  isImageExportable,
} from '../../lib/chartExport'
import { downloadCsv } from '../../lib/csv'
import type { ChartType } from '../../types'
import { ActionMenu, type ActionMenuItem, type ActionMenuSection } from '../ui/ActionMenu'
import { useChartTheme } from './theme'

interface Props {
  /** Resolves the element that holds the rendered chart; the <svg> is looked up
   *  inside it at click time (a chart may re-render between renders of this menu). */
  getChartEl: () => HTMLElement | null
  /** Drives which formats are offered — DOM-rendered types get CSV only. */
  chartType: ChartType
  /** Rows behind the chart, for the CSV export (already filtered by the caller). */
  rows: Record<string, unknown>[]
  /** Human title; slugified into the filename. */
  title?: string | null
  /** Filename stem used when `title` is empty. */
  fallbackName?: string
  /** Icon-only trigger for tight spots like a widget header. */
  compact?: boolean
}

/**
 * The download menu shared by every chart surface: CSV always, PNG/SVG only for
 * the recharts (SVG) chart types. `table`, `pivot` and `kpi_card` render as plain
 * DOM, so the image rows are absent rather than present-and-broken.
 */
export function ChartExportMenu({
  getChartEl,
  chartType,
  rows,
  title,
  fallbackName = 'nexusbi-export',
  compact = false,
}: Props) {
  const { t } = useTranslation()
  const theme = useChartTheme()

  const nameFor = (ext: 'csv' | 'png' | 'svg') =>
    title?.trim() ? exportFilename(title, ext) : `${fallbackName}.${ext}`

  const exportImage = async (format: 'png' | 'svg') => {
    const svg = findChartSvg(getChartEl())
    if (!svg) {
      toast.error(t('chartExport.failed'))
      return
    }
    // Export on the theme's own surface colour, so a chart pulled from dark mode
    // isn't a transparent PNG that turns unreadable on a light slide.
    const opts = { background: theme.SURFACE }
    try {
      if (format === 'svg') downloadChartSvg(svg, nameFor('svg'), opts)
      else await downloadChartPng(svg, nameFor('png'), opts)
    } catch {
      toast.error(t('chartExport.failed'))
    }
  }

  const items: ActionMenuItem[] = [
    {
      key: 'csv',
      Icon: FileSpreadsheet,
      label: t('chartExport.csv'),
      onSelect: () => downloadCsv(rows, nameFor('csv')),
      disabled: rows.length === 0,
    },
  ]
  if (isImageExportable(chartType)) {
    items.push(
      { key: 'png', Icon: ImageIcon, label: t('chartExport.png'), onSelect: () => exportImage('png') },
      { key: 'svg', Icon: FileCode2, label: t('chartExport.svg'), onSelect: () => exportImage('svg') },
    )
  }

  const sections: ActionMenuSection[] = [{ header: t('chartExport.group'), items }]

  return (
    <ActionMenu
      ariaLabel={t('chartExport.trigger')}
      triggerLabel={compact ? '' : t('chartExport.trigger')}
      triggerIcon={Download}
      sections={sections}
    />
  )
}
