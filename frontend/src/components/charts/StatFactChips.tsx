import { AlertTriangle, Crown, Sigma, TrendingDown, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { StatFact } from '../../types'

/** Deterministic computed facts (total / top / period Δ / anomalies) rendered as
 * compact chips under the AI insight — the math the narrative is grounded on.
 * The descriptor is localized from `kind`; `label` (top category) is data. */
export function StatFactChips({ facts }: { facts: StatFact[] }) {
  const { t } = useTranslation()
  if (!facts.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {facts.map((f, i) => {
        const descriptor = f.kind === 'top' ? f.label : t(`statFacts.${f.kind}`)
        return (
          <span
            key={i}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] ${styleFor(f)}`}
          >
            {iconFor(f)}
            <span className="text-ink-soft">{descriptor}</span>
            <span className="font-medium text-ink">{f.value}</span>
          </span>
        )
      })}
    </div>
  )
}

// A rounded ±0% delta is essentially flat — render it neutral, not a red decline.
const isFlat = (f: StatFact) => f.kind === 'trend' && /^[+-]?0%$/.test(f.value)

function styleFor(f: StatFact): string {
  if (f.kind === 'anomaly') return 'border-amber-500/40 bg-amber-500/10'
  if (f.kind === 'trend') {
    if (isFlat(f)) return 'border-line bg-surface-2'
    return f.value.startsWith('-')
      ? 'border-red-500/40 bg-red-500/10'
      : 'border-accent/40 bg-accent-soft'
  }
  if (f.kind === 'top') return 'border-accent/40 bg-accent-soft'
  return 'border-line bg-surface-2'
}

function iconFor(f: StatFact) {
  const cls = 'shrink-0'
  if (f.kind === 'anomaly') return <AlertTriangle size={12} className={`${cls} text-amber-500`} />
  if (f.kind === 'trend') {
    if (isFlat(f)) return <Sigma size={12} className={`${cls} text-ink-faint`} />
    return f.value.startsWith('-') ? (
      <TrendingDown size={12} className={`${cls} text-red-400`} />
    ) : (
      <TrendingUp size={12} className={`${cls} text-accent`} />
    )
  }
  if (f.kind === 'top') return <Crown size={12} className={`${cls} text-accent`} />
  return <Sigma size={12} className={`${cls} text-ink-faint`} />
}
