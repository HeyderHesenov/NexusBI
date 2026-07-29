import { useTranslation } from 'react-i18next'
import type { ChartConfig } from '../../../types'
import { useChartValueFormatter } from '../../../hooks/useChartValueFormatter'
import { topN, type Row } from './previewData'

// Four rows read cleanly at the card's ~198px (phone) to ~264px (desktop) width.
// The real chart folds at 14 (BarChartWidget.tsx:25) — a preview is a glance.
const ROWS = 4

/** Ranked bars as HTML, not SVG: the labels are the point, and CSS `truncate`
 *  gives ellipsis that SVG can't without measuring text by hand. Every bar shares
 *  one emerald, mirroring BarChartWidget's rule — length + label carry meaning.
 *  Assumes viable input (rows with a positive value total) — ChartPreview is the
 *  single place that decides that and falls back to a table summary if not. */
export function BarListPreview({ data, config }: { data: Row[]; config: ChartConfig }) {
  const { t } = useTranslation()
  const fmtVal = useChartValueFormatter(config.format)
  const { rows, rest, max } = topN(data, config, ROWS)

  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-[34%] shrink-0 truncate text-[10px] text-ink-soft" title={r.label}>
            {r.label}
          </span>
          <span className="relative h-2.5 flex-1 overflow-hidden rounded-sm bg-surface-2">
            <span
              className="absolute inset-y-0 left-0 rounded-sm bg-accent"
              style={{ width: `${Math.max((Math.abs(r.value) / max) * 100, 2)}%` }}
            />
          </span>
          <span className="shrink-0 text-[10px] font-medium tabular-nums text-ink">
            {fmtVal(r.value)}
          </span>
        </div>
      ))}
      {rest > 0 && (
        <p className="text-[10px] text-ink-faint">{t('shareCard.morePreview', { count: rest })}</p>
      )}
    </div>
  )
}
