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
 * Colour choices are deliberate, and every one of them was measured in BOTH
 * themes — a ratio that passes in the dark says nothing about the light.
 *
 *  measured  full-opacity accent RING, not accent text on accent-soft: that
 *            pairing is 2.95:1 in light mode and fails, while the ring is
 *            3.39:1 light / 6.56:1 dark and shifts no layout.
 *  unknown   danger-tinted border and icon, but the LABEL stays `text-ink`.
 *            #D87C6B text measures 2.99:1 on --surface and 2.72:1 on
 *            --surface-2 in light mode (it is a comfortable 5.56:1 in dark), so
 *            tinting 10px text would fail WCAG 1.4.3 in exactly the state the
 *            user is supposed to act on. Same call as ecbeb03: stop tinting
 *            labels that measure under 4.5:1, keep the hue on the chrome. The
 *            icon is aria-hidden and the word carries the meaning.
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
        ? 'border border-[#D87C6B]/50 text-ink [&>svg]:text-[#D87C6B]'
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
