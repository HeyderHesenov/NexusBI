import { ArrowDownRight, ArrowUpRight, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ExplainResult } from '../../types'

/** Root-cause: shows the biggest drivers behind a result. */
export function ExplainPanel({ result }: { result: ExplainResult }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex items-center gap-2">
        <Sparkles size={15} className="text-accent" />
        <p className="eyebrow text-ink-soft">{result.summary || t('explainPanel.rootCauseAnalysis')}</p>
      </div>
      {result.drivers.length === 0 ? (
        <p className="text-sm text-ink-faint">{t('explainPanel.noDrivers')}</p>
      ) : (
        <ul className="space-y-1.5">
          {result.drivers.map((d, i) => {
            const down = d.direction === 'down'
            return (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              >
                <span className={`mt-0.5 shrink-0 ${down ? 'text-[#D87C6B]' : 'text-accent'}`}>
                  {down ? <ArrowDownRight size={15} /> : <ArrowUpRight size={15} />}
                </span>
                <div className="min-w-0">
                  <span className="font-medium text-ink">{d.label}</span>
                  {d.contribution != null && (
                    <span className="ml-1.5 font-mono text-xs text-ink-faint">
                      ~{d.contribution}%
                    </span>
                  )}
                  {d.note && <p className="text-ink-soft">{d.note}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
