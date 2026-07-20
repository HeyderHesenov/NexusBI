import { useTranslation } from 'react-i18next'
import type { Row } from './previewData'

// The card is ~198px wide on a phone: two columns of three rows is the honest limit.
const ROWS = 3
const COLS = 2

/** Tables and pivots have no shape to draw, so the preview states the size and
 *  shows the first cells — the dialog is where you actually read them.
 *  Also the fallback for chart types newer than this client build. */
export function TableSummaryPreview({ data, columns }: { data: Row[]; columns?: string[] }) {
  const { t } = useTranslation()
  const keys = columns?.length ? columns : Object.keys(data[0] ?? {})
  if (!keys.length || !data.length) return null
  const shown = keys.slice(0, COLS)

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium text-ink-soft">
        {t('shareCard.tableSummary', { rows: data.length, cols: keys.length })}
      </p>
      <div className="overflow-hidden rounded-md border border-line">
        <table className="w-full table-fixed">
          <thead>
            <tr className="border-b border-line bg-surface-2">
              {shown.map((c) => (
                <th key={c} className="truncate px-1.5 py-1 text-left text-[9px] font-semibold text-ink-soft">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.slice(0, ROWS).map((row, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                {shown.map((c) => (
                  <td key={c} className="truncate px-1.5 py-1 text-[9px] text-ink">
                    {String(row[c] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
