import { AlertTriangle, Crown, PieChart, Sigma, TrendingDown, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { BAFact } from '../../types'

/**
 * The provenance strip for a framework artifact: numbers computed from the source,
 * never written by the model.
 *
 * Mirrors the chip grammar of charts/StatFactChips so a fact reads the same
 * wherever it appears, with one addition — `title` carries the source string, so a
 * chip is traceable back to the column it came from.
 */
export function EvidenceChips({
  facts,
  className = '',
}: {
  facts: BAFact[]
  className?: string
}) {
  const { t } = useTranslation()
  if (!facts.length) return null
  return (
    <div
      data-testid="ba-evidence-chips"
      className={`flex flex-wrap gap-1.5 ${className}`}
    >
      {facts.map((f) => {
        const descriptor = f.label || t(`baStudio.fact_${f.kind}`)
        return (
          <span
            key={f.id}
            title={f.source}
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

/**
 * The honesty marker on a single bullet. A rule-derived bullet shows the facts it
 * is computed from; a model-authored one is labelled a judgement, because an LLM
 * citation cannot be verified and a "grounded" badge on one would launder it.
 *
 * `hasFacts` suppresses the judgement label when the artifact has no facts at all
 * (legacy artifacts, or a source we could not profile): with nothing to contrast
 * against, labelling every bullet is noise rather than information.
 */
export function ItemEvidence({
  cited,
  derived,
  hasFacts,
}: {
  cited: BAFact[]
  derived: boolean
  hasFacts: boolean
}) {
  const { t } = useTranslation()
  if (!derived || !cited.length) {
    if (!hasFacts) return null
    return (
      <span className="eyebrow mt-1 inline-block text-ink-faint">{t('baStudio.judgement')}</span>
    )
  }
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      <span className="eyebrow text-accent">{t('baStudio.derived')}</span>
      {cited.map((f) => (
        <span
          key={f.id}
          title={f.source}
          className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-1.5 py-0.5 font-mono text-[10px]"
        >
          {iconFor(f)}
          <span className="font-medium text-ink">{f.value}</span>
        </span>
      ))}
    </span>
  )
}

// A rounded ±0% delta is essentially flat — render it neutral, not a red decline.
const isFlat = (f: BAFact) => f.kind === 'trend' && /^[+-]?0%$/.test(f.value)

function styleFor(f: BAFact): string {
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

function iconFor(f: BAFact) {
  const cls = 'shrink-0'
  if (f.kind === 'anomaly') return <AlertTriangle size={12} className={`${cls} text-amber-500`} />
  if (f.kind === 'concentration') return <PieChart size={12} className={`${cls} text-ink-faint`} />
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
