import { useTranslation } from 'react-i18next'
import { CircleDashed } from 'lucide-react'
import { collectLeaves } from '../../lib/metricTreeMath'
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
    <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
      <div className="max-w-lg">
        <CircleDashed size={24} className="mx-auto text-ink-faint" />
        <p className="mt-3 font-display text-lg text-ink">{t('twinPage.incomplete.title')}</p>
        <p className="mt-1 text-sm text-ink-soft">{t('twinPage.incomplete.body')}</p>
        {unknown.length > 0 && (
          <ul className="mt-4 flex flex-wrap justify-center gap-1.5">
            {unknown.map((leaf) => (
              <li
                key={leaf.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#D87C6B]/50 px-2.5 py-1 text-xs text-ink"
              >
                <span className="font-medium">{leaf.name}</span>
                <span className="text-ink-faint">
                  {t(`twinPage.reason.${leaf.unknown_reason ?? 'empty'}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={onGoToTree}
          className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press"
        >
          {t('twinPage.incomplete.cta')}
        </button>
      </div>
    </div>
  )
}
