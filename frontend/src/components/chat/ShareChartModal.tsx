import { BarChart3, Download, Table2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ShareMeta } from '../../api/chat'
import { downloadCsv } from '../../lib/csv'
import { ChartFullscreenModal } from '../charts/ChartFullscreenModal'
import { ChartRenderer } from '../charts/LazyChartRenderer'

type ShareChart = NonNullable<ShareMeta['chart']>

/** Turn a card title into a tidy download name. */
const filename = (title: string) => {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `nexusbi-${slug || 'export'}.csv`
}

/** The honest view of a shared chart: full size, legend on, rows one toggle away.
 *  Every room member gets this — the snapshot already travels in their copy of the
 *  message (chat_share_service.py's screenshot semantics), so nothing new is
 *  disclosed; the card is just too small to read it in.
 *
 *  Mounted only while open (ShareCard owns the state), which is what keeps
 *  recharts' dynamic import off the chat thread until someone actually clicks. */
export function ShareChartModal({
  meta,
  chart,
  onClose,
}: {
  meta: ShareMeta
  chart: ShareChart
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [asTable, setAsTable] = useState(false)
  // Tables and pivots ARE the rows — there's nothing to toggle to.
  const canToggle = chart.chart_type !== 'table' && chart.chart_type !== 'pivot'
  const config =
    asTable && canToggle ? { ...chart.chart_config, chart_type: 'table' as const } : chart.chart_config

  return (
    <ChartFullscreenModal open onClose={onClose} title={meta.title}>
      <div className="flex h-full flex-col gap-3">
        {/* flex-wrap: on a 360px phone the toggle and CSV must wrap, not overflow. */}
        <div className="flex flex-wrap items-center gap-2">
          {canToggle && (
            <div className="flex items-center gap-1 rounded-lg border border-line p-0.5">
              {[
                { table: false, label: t('chartView.chart'), Icon: BarChart3 },
                { table: true, label: t('chartToolbar.table'), Icon: Table2 },
              ].map(({ table, label, Icon }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setAsTable(table)}
                  aria-pressed={asTable === table}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    asTable === table
                      ? 'bg-accent-soft text-accent'
                      : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => downloadCsv(chart.data, filename(meta.title))}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-soft transition hover:border-line-strong hover:text-ink"
          >
            <Download size={13} /> {t('chartView.downloadCsv')}
          </button>
        </div>

        <div className="min-h-0 flex-1">
          <ChartRenderer data={chart.data} config={config} height="100%" showLegend />
        </div>

        {chart.insight && (
          <p className="shrink-0 text-sm text-ink-soft">
            <span className="font-semibold text-ink">{t('queryPage.insight')}: </span>
            {chart.insight}
          </p>
        )}
        {chart.truncated && (
          <p className="shrink-0 text-xs text-ink-faint">
            {t('shareCard.truncated', { count: chart.data.length })}
          </p>
        )}
      </div>
    </ChartFullscreenModal>
  )
}
