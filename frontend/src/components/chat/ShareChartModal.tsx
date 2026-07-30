import { BarChart3, Table2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ShareMeta } from '../../api/chat'
import { ChartExportMenu } from '../charts/ChartExportMenu'
import { ChartFullscreenModal } from '../charts/ChartFullscreenModal'
import { ChartRenderer } from '../charts/LazyChartRenderer'

type ShareChart = NonNullable<ShareMeta['chart']>

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
  const chartRef = useRef<HTMLDivElement>(null)
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
          {/* Image formats follow the VISIBLE view: flipping to the table drops
              them, because a table renders as DOM and has no <svg> to serialize. */}
          <ChartExportMenu
            getChartEl={() => chartRef.current}
            chartType={config.chart_type}
            rows={chart.data}
            title={meta.title}
          />
        </div>

        <div ref={chartRef} className="min-h-0 flex-1">
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
