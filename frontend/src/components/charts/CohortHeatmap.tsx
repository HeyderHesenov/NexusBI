import { useTranslation } from 'react-i18next'
import { bestTextOn, mixHex } from '../../lib/color'
import type { CohortData } from '../../types'
import { useChartTheme } from './theme'

interface Props {
  data: CohortData
}

/** Accent-overlay opacity for a 0–100 pct (floored so even 0% cells read as cells). */
function alphaOf(pct: number): number {
  return 0.08 + (pct / 100) * 0.84
}

/** Cohort retention heatmap — hand-rolled grid, theme-aware accent scale. */
export function CohortHeatmap({ data }: Props) {
  const { t } = useTranslation()
  const theme = useChartTheme()

  if (!data.cohorts.length) {
    return <p className="text-sm text-ink-soft">{t('cohortPage.empty')}</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-xs" data-testid="cohort-heatmap">
        <thead>
          <tr className="text-left text-ink-faint">
            <th className="px-2 py-1 font-medium">{t('cohortPage.cohortCol')}</th>
            <th className="px-2 py-1 text-right font-medium">{t('cohortPage.sizeCol')}</th>
            {data.offsets.map((k) => (
              <th key={k} className="px-2 py-1 text-center font-mono font-medium">
                +{k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.cohorts.map((label, row) => (
            <tr key={label}>
              <td className="whitespace-nowrap px-2 py-1 font-mono text-ink-soft">{label}</td>
              <td className="px-2 py-1 text-right font-mono text-ink-soft">{data.sizes[row]}</td>
              {data.cells[row].map((cell, col) =>
                cell === null ? (
                  <td key={col} className="rounded-md px-2 py-1 text-center text-ink-faint">
                    ·
                  </td>
                ) : (
                  <td
                    key={col}
                    className="rounded-md px-2 py-1 text-center font-mono tabular-nums"
                    title={t('cohortPage.cellTitle', { count: cell.count, size: data.sizes[row] })}
                    // Text color is picked against the EFFECTIVE cell color (accent
                    // alpha-composited over the surface) — a fixed threshold reads
                    // wrong in one of the two themes.
                    style={(() => {
                      const surface = String(theme.tooltipStyle.background)
                      const effective = mixHex(surface, theme.ACCENT, alphaOf(cell.pct))
                      return { background: effective, color: bestTextOn(effective) }
                    })()}
                  >
                    {cell.pct}%
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
