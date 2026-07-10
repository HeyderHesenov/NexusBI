import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AnomalyResult } from '../../types'
import { useFormatNumber } from '../../hooks/useFormatNumber'

const SEVERITY: Record<string, string> = {
  high: 'border-red-500/40 bg-red-500/10 text-red-300',
  medium: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  low: 'border-line bg-surface-2 text-ink-soft',
}

export function AnomalyPanel({ result }: { result: AnomalyResult }) {
  const { t } = useTranslation()
  const fmtNum = useFormatNumber()
  if (!result.anomalies.length) {
    return (
      <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink-soft">
        {result.summary || t('anomalyPanel.noAnomalies')}
      </div>
    )
  }
  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex items-center gap-2">
        <AlertTriangle size={15} className="text-amber-400" />
        <p className="eyebrow flex-1 text-ink-soft">{result.summary || t('anomalyPanel.anomalies')}</p>
        {result.method === 'mad+isolation_forest' && (
          <span
            className="shrink-0 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent"
            title={t('anomalyPanel.multivariateHint')}
          >
            {t('anomalyPanel.multivariate')}
          </span>
        )}
      </div>
      <ul className="space-y-1.5">
        {result.anomalies.map((a, i) => (
          <li
            key={i}
            className="flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          >
            <span
              className={`mt-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                SEVERITY[a.severity] ?? SEVERITY.low
              }`}
            >
              {a.severity}
            </span>
            <div>
              <span className="font-medium text-ink">{a.label}</span>
              {a.value != null && (
                <span className="ml-1.5 font-mono text-xs text-ink-faint">
                  {fmtNum(a.value)}
                </span>
              )}
              <p className="text-ink-soft">{a.explanation}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
