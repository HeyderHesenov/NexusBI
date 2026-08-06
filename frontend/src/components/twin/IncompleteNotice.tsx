import { useTranslation } from 'react-i18next'
import { CircleDashed } from 'lucide-react'
import { collectLeaves } from '../../lib/metricTreeMath'
import { TwinEmptyState } from './TwinEmptyState'
import type { EvaluatedNode } from '../../types'

/**
 * What the Twin shows instead of a simulation when the KPI has no value.
 *
 * The alternative — drawing the waterfall, the tornado and the Monte Carlo
 * histogram from a tree with an unknown leaf — produces charts that look
 * exactly like a real answer. Naming the empty leaves is the part that makes
 * this actionable: "incomplete" alone sends the user hunting through the tree.
 */
export function IncompleteNotice({
  root,
  onGoToTree,
}: {
  root: EvaluatedNode
  onGoToTree: () => void
}) {
  const { t } = useTranslation()
  const unknown = collectLeaves(root).filter((l) => l.provenance === 'unknown')

  return (
    <TwinEmptyState
      icon={CircleDashed}
      title={t('twinPage.incomplete.title')}
      body={t('twinPage.incomplete.body')}
      cta={t('twinPage.incomplete.cta')}
      onCta={onGoToTree}
    >
      {unknown.length > 0 && (
        <ul className="mt-4 flex flex-wrap justify-center gap-1.5">
          {unknown.map((leaf) => (
            <li
              key={leaf.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-danger/50 px-2.5 py-1 text-xs text-ink"
            >
              <span className="font-medium">{leaf.name}</span>
              <span className="text-ink-faint">
                {t(`twinPage.reason.${leaf.unknown_reason ?? 'empty'}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </TwinEmptyState>
  )
}
