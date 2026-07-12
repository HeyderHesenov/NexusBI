import { memo } from 'react'
import {
  ArrowRight,
  BarChart3,
  BookMarked,
  BrainCircuit,
  Compass,
  LayoutDashboard,
  Share2,
  ShieldCheck,
  Tag,
  Target,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CopilotAction } from '../../api/copilot'
import { shareNavAction } from '../../api/chat'
import type { ShareMeta, ShareResourceType } from '../../api/chat'
import { useChartValueFormatter } from '../../hooks/useChartValueFormatter'
import { deriveKpiSeries } from '../../lib/kpi'
import { formatSignedPct } from '../../lib/format'
import { ChartRenderer } from '../charts/LazyChartRenderer'
import { Sparkline } from '../charts/Sparkline'

// Type badges reuse the sidebar's icon language where the type has a nav entry.
const TYPE_ICONS: Record<ShareResourceType, LucideIcon> = {
  query_log: BarChart3,
  dashboard: LayoutDashboard,
  saved_query: BookMarked,
  ml_model: BrainCircuit,
  ba_artifact: Compass,
  decision: Target,
  contract: ShieldCheck,
  metric: Tag,
}

/** A KPI result compresses to a number + delta + sparkline (KPICard is p-10/text-6xl). */
function KpiTile({ chart }: { chart: NonNullable<ShareMeta['chart']> }) {
  const series = deriveKpiSeries(chart.data, chart.chart_config)
  const fmtVal = useChartValueFormatter(chart.chart_config.format)
  // Tone and trend derive from the SAME 1-decimal rounding formatSignedPct
  // applies (mirrors KPICard), so a −0.02% delta can't pair a red tone with
  // a "+0%" label.
  const rounded = series.deltaPct == null ? null : Math.round(series.deltaPct * 10) / 10
  return (
    <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate font-display text-2xl font-bold text-ink">
          {series.latest != null ? fmtVal(series.latest, { compact: false }) : '—'}
        </p>
        {series.deltaPct != null && (
          <p
            className={`text-xs font-medium ${
              rounded === 0 ? 'text-ink-soft' : rounded! > 0 ? 'text-accent' : 'text-[#D87C6B]'
            }`}
          >
            {formatSignedPct(series.deltaPct)}
          </p>
        )}
      </div>
      <Sparkline
        points={series.points}
        width={96}
        height={24}
        trend={rounded == null ? undefined : rounded < 0 ? 'down' : 'up'}
      />
    </div>
  )
}

/** Rich card for an artifact shared into the room — chart snapshot for query
 *  results, reference card for everything else. The "open" chip renders only
 *  for the sharer (`canOpen`): every target page is owner-scoped, so for
 *  recipients the card itself IS the share (screenshot semantics). Memoized —
 *  ChatPage re-renders on every composer keystroke. */
export const ShareCard = memo(function ShareCard({
  meta,
  canOpen,
  onOpen,
}: {
  meta: ShareMeta
  canOpen: boolean
  onOpen: (a: CopilotAction) => void
}) {
  const { t } = useTranslation()
  // Fallback for share types newer than this client build.
  const Icon = TYPE_ICONS[meta.resource_type] ?? Share2
  const chart = meta.chart && meta.chart.data.length > 0 ? meta.chart : null
  return (
    <div className="mt-2 w-72 max-w-full overflow-hidden rounded-xl border border-line bg-surface p-3 text-left">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
        <Icon size={13} className="text-accent" /> {t(`shareCard.type_${meta.resource_type}`)}
      </div>
      <p className="mt-1 truncate text-sm font-semibold text-ink">{meta.title}</p>
      {meta.subtitle && <p className="truncate text-xs text-ink-faint">{meta.subtitle}</p>}

      {chart && chart.chart_type !== 'kpi_card' && (
        <div className="mt-2 h-44 w-full overflow-hidden">
          <ChartRenderer
            data={chart.data}
            config={chart.chart_config}
            height="100%"
            showLegend={false}
          />
        </div>
      )}
      {chart && chart.chart_type === 'kpi_card' && <KpiTile chart={chart} />}
      {chart?.truncated && (
        <p className="mt-1 text-[10px] text-ink-faint">
          {t('shareCard.truncated', { count: chart.data.length })}
        </p>
      )}

      {canOpen && (
        <button
          onClick={() => onOpen(shareNavAction(meta))}
          className="mt-2 flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent transition hover:border-accent"
        >
          {t('shareCard.open')} <ArrowRight size={12} />
        </button>
      )}
    </div>
  )
})
