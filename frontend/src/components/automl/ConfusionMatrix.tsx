import { useTranslation } from 'react-i18next'
import { DANGER, useChartTheme } from '../charts/theme'
import type { MLDiagnostics } from '../../types'

/** Alpha-as-hex suffix (00–ff) so a cell's tint encodes its share of the row's
 *  peak count — correct hits deepen in emerald, mistakes in the danger hue. */
function tint(hex: string, intensity: number): string | undefined {
  if (intensity <= 0) return undefined
  const a = Math.round((0.14 + 0.86 * intensity) * 255)
  return `${hex}${a.toString(16).padStart(2, '0')}`
}

/** Holdout confusion matrix: rows = actual class, columns = predicted class. The
 *  emerald diagonal is where the model was right; danger-tinted off-diagonal cells
 *  are where it confused two classes. */
export function ConfusionMatrix({ cm }: { cm: NonNullable<MLDiagnostics['confusion']> }) {
  const { t } = useTranslation()
  const { ACCENT, AXIS } = useChartTheme()
  const { labels, matrix } = cm
  // Scale each cell against its own row's max so a rare class still reads.
  const rowMax = matrix.map((row) => Math.max(1, ...row))

  return (
    <div>
      <p className="eyebrow mb-2">{t('automl.confusionTitle')}</p>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="p-1" />
              <th
                className="px-2 pb-1 text-center font-medium text-ink-faint"
                colSpan={labels.length}
                scope="colgroup"
              >
                {t('automl.confusionPredicted')}
              </th>
            </tr>
            <tr>
              <th className="p-1" />
              {labels.map((l) => (
                <th key={l} className="px-2 py-1 text-center font-mono text-ink-soft" scope="col">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={labels[i]}>
                <th
                  className="whitespace-nowrap py-1 pr-2 text-right font-mono text-ink-soft"
                  scope="row"
                >
                  {i === 0 && (
                    <span className="mr-2 text-ink-faint" style={{ writingMode: 'vertical-rl' }}>
                      {t('automl.confusionActual')}
                    </span>
                  )}
                  {labels[i]}
                </th>
                {row.map((count, j) => {
                  const correct = i === j
                  const bg = tint(correct ? ACCENT : DANGER, count / rowMax[i])
                  return (
                    <td
                      key={`${labels[i]}-${labels[j]}`}
                      className="border border-line/60 px-3 py-2 text-center font-mono tabular-nums text-ink"
                      style={{ backgroundColor: bg }}
                      title={`${labels[i]} → ${labels[j]}: ${count}`}
                    >
                      <span style={count === 0 ? { color: AXIS } : undefined}>{count}</span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
