import { memo, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  BookMarked,
  BrainCircuit,
  Compass,
  LayoutDashboard,
  Maximize2,
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
import { ChartPreview } from '../charts/previews/ChartPreview'
import { ShareChartModal } from './ShareChartModal'

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

/** Rich card for an artifact shared into the room — a glanceable chart preview
 *  for query results, a reference card for everything else. The preview is a
 *  summary, not the chart: at 288×176 a real one is unreadable, so clicking it
 *  opens the full-size dialog. That dialog is offered to EVERYONE, since the
 *  snapshot already travels in every member's copy of the message.
 *
 *  The "open" chip is different and stays `canOpen`-gated: it navigates to an
 *  owner-scoped page, so for recipients the card itself IS the share.
 *
 *  Memoized — ChatPage re-renders on every composer keystroke. The dialog's
 *  `open` state therefore lives HERE, not in ChatPage: hoisting it would hand
 *  every card a fresh callback prop per keystroke, killing this memo for the
 *  whole thread and re-rendering the open dialog on every character typed. */
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
  const [open, setOpen] = useState(false)
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

      {chart && (
        // Only the preview is the button — the "open" chip below is a sibling.
        // Wrapping the whole card would nest buttons; `role="button"` on the root
        // would be worse still, making the chip presentational and unreachable.
        // `text-left` because <button> centers text and the root's won't survive.
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('shareCard.expand', { title: meta.title })}
          className="group relative mt-2 block w-full cursor-pointer rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {/* Decorative: the dialog is the honest view, so keep the summary out of
              the a11y tree and let the button's label speak for it. */}
          <div aria-hidden="true">
            <ChartPreview
              data={chart.data}
              config={chart.chart_config}
              columns={chart.columns}
            />
          </div>
          <span className="pointer-events-none absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md bg-surface/80 text-ink-soft opacity-0 backdrop-blur-sm transition group-hover:opacity-100 group-focus-visible:opacity-100">
            <Maximize2 size={12} />
          </span>
        </button>
      )}
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

      {open && chart && (
        <ShareChartModal meta={meta} chart={chart} onClose={() => setOpen(false)} />
      )}
    </div>
  )
})
