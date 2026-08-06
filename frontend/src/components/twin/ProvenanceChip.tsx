import { useTranslation } from 'react-i18next'
import { CircleDashed, Database, PenLine } from 'lucide-react'
import type { EvaluatedNode, LeafProvenance } from '../../types'
import { useFormatDate } from '../../hooks/useFormatDate'

const ICON: Record<LeafProvenance, typeof Database> = {
  measured: Database,
  manual: PenLine,
  unknown: CircleDashed,
}

/**
 * Where a leaf's number came from, said out loud next to the number.
 *
 * Both states carry their hue on the CHROME, never the 10px word: `measured`
 * uses a full-opacity accent ring, `unknown` a danger border + aria-hidden
 * icon, and both leave the LABEL `text-ink`. Keeping the two parallel shifts no
 * layout and lets the word itself carry the meaning. The accent/danger tokens
 * were darkened so they now clear AA as text in BOTH themes too (a ratio that
 * passes in the dark says nothing about the light — measure both), but the
 * chrome-not-text pattern stays the deliberate look (precedent: ecbeb03).
 */
export function ProvenanceChip({ node, className = '' }: { node: EvaluatedNode; className?: string }) {
  const { t } = useTranslation()
  const fmtDate = useFormatDate()
  const kind = node.provenance
  if (!kind) return null
  const Icon = ICON[kind]

  const tone =
    kind === 'measured'
      ? 'ring-1 ring-accent text-ink'
      : kind === 'unknown'
        ? 'border border-danger/50 text-ink [&>svg]:text-danger'
        : 'border border-line text-ink-soft'

  // The tooltip carries the detail the chip has no room for: which query and
  // column, and how old the number is. An unknown leaf explains itself instead.
  // Via the shared formatter, not `new Date(...).toLocaleString(i18n.language)`:
  // an offset-less stamp (what SQLite deployments send) parses as local time
  // there, so the "how old is this number" tooltip was off by the viewer's
  // offset — in the one place whose whole job is stating when a number was true.
  const measuredAt = node.measured_at ? fmtDate(node.measured_at, { mode: 'short' }) : null
  const title =
    kind === 'unknown'
      ? t(`twinPage.reason.${node.unknown_reason ?? 'empty'}`)
      : [node.source, measuredAt && t('twinPage.provenance.measuredAt', { at: measuredAt })]
          .filter(Boolean)
          .join(' · ') || undefined

  return (
    <span
      data-provenance={kind}
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tone} ${className}`}
    >
      <Icon size={10} aria-hidden />
      {t(`twinPage.provenance.${kind}`)}
    </span>
  )
}

/** The KPI number, or an em dash when the tree cannot produce one.
 *  A leaf with no value must never render as 0 — that is the bug this phase
 *  exists to remove, and `formatMetricValue(0)` is indistinguishable from a
 *  real zero. */
export function MetricValue({
  value,
  format,
  className = '',
}: {
  value: number | null
  format: (n: number) => string
  className?: string
}) {
  const { t } = useTranslation()
  if (value === null) {
    return (
      <span className={`text-ink-faint ${className}`} title={t('twinPage.provenance.noValue')}>
        —
      </span>
    )
  }
  return <span className={className}>{format(value)}</span>
}
