import { useTranslation } from 'react-i18next'
import { CircleDashed, Database, PenLine } from 'lucide-react'
import type { EvaluatedNode, LeafProvenance } from '../../types'

const ICON: Record<LeafProvenance, typeof Database> = {
  measured: Database,
  manual: PenLine,
  unknown: CircleDashed,
}

/**
 * Where a leaf's number came from, said out loud next to the number.
 *
 * Colour choices are deliberate. `measured` gets a full-opacity accent ring
 * rather than accent text on accent-soft: that pairing measures 2.95:1 in light
 * mode and fails, while the ring measures 3.39:1 light / 6.56:1 dark and shifts
 * no layout. `unknown` is the only state that borrows the danger hue — it is
 * the one the user has to act on.
 */
export function ProvenanceChip({ node, className = '' }: { node: EvaluatedNode; className?: string }) {
  const { t, i18n } = useTranslation()
  const kind = node.provenance
  if (!kind) return null
  const Icon = ICON[kind]

  const tone =
    kind === 'measured'
      ? 'ring-1 ring-accent text-ink'
      : kind === 'unknown'
        ? 'border border-[#D87C6B]/50 text-[#D87C6B]'
        : 'border border-line text-ink-soft'

  // The tooltip carries the detail the chip has no room for: which query and
  // column, and how old the number is. An unknown leaf explains itself instead.
  const measuredAt = node.measured_at
    ? new Date(node.measured_at).toLocaleString(i18n.language)
    : null
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
