import { useTranslation } from 'react-i18next'
import type { ImpactStatus } from '../../types'

/** The five verdicts a tracked decision can carry, and how each one reads.
 *
 *  Moved here verbatim from DecisionsPage so the requirements page can report
 *  the same verdict in the same words and colours. Nothing was restyled in the
 *  move: introducing a status colour is a design decision graded by
 *  components/charts/theme.test.ts, and reusing an existing one is not. */
export const IMPACT: Record<ImpactStatus, { labelKey: string; cls: string }> = {
  pending: { labelKey: 'decisionsPage.impactPending', cls: 'border-line text-ink-faint' },
  on_track: { labelKey: 'decisionsPage.impactOnTrack', cls: 'border-accent/40 bg-accent-soft text-accent' },
  achieved: { labelKey: 'decisionsPage.impactAchieved', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' },
  missed: { labelKey: 'decisionsPage.impactMissed', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  regressed: { labelKey: 'decisionsPage.impactRegressed', cls: 'border-red-500/40 bg-red-500/10 text-red-400' },
}

export function ImpactBadge({ status }: { status: ImpactStatus }) {
  const { t } = useTranslation()
  const impact = IMPACT[status]
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${impact.cls}`}>
      {t(impact.labelKey)}
    </span>
  )
}
