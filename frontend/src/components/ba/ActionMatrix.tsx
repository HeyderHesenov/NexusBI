import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Loader2, Target } from 'lucide-react'
import type { BAAction } from '../../types'
import { byPriority } from '../../lib/baItems'

/**
 * Impact × effort prioritisation, then the loop out to a tracked decision.
 *
 * Deliberately a CSS quadrant grid rather than an SVG scatter (which BCGMatrix
 * earns, because there bubble radius and continuous position carry information):
 * impact and effort are integers 1–5, so two actions sharing a cell would plot
 * exactly on top of each other, and dots would need label-collision handling plus
 * manual focus management. Real buttons in a cell give the same information,
 * keyboard-accessible for free.
 */
const QUADRANTS = [
  // high impact, low effort → do first
  { key: 'quickWin', hiImpact: true, loEffort: true },
  { key: 'bigBet', hiImpact: true, loEffort: false },
  { key: 'fillIn', hiImpact: false, loEffort: true },
  { key: 'thankless', hiImpact: false, loEffort: false },
] as const

const MID = 3 // impact/effort ≥ 3 counts as high — matches the 1..5 clamp

function quadrantOf(a: BAAction): string {
  const hiImpact = a.impact >= MID
  const loEffort = a.effort < MID
  return (
    QUADRANTS.find((q) => q.hiImpact === hiImpact && q.loEffort === loEffort)?.key ?? 'thankless'
  )
}

export function ActionMatrix({
  actions,
  onPromote,
}: {
  actions: BAAction[]
  onPromote: (index: number) => Promise<void>
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<number | null>(null)
  if (!actions.length) {
    return <p className="text-sm text-ink-soft">{t('baStudio.actionsEmpty')}</p>
  }

  // Index into the ORIGINAL array travels with each action: promote addresses the
  // action by its stored position, which reordering must not shift.
  const indexed = byPriority(actions.map((a, index) => ({ ...a, index })))

  const run = async (index: number) => {
    setBusy(index)
    try {
      await onPromote(index)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div data-testid="ba-action-matrix" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        {QUADRANTS.map((q) => {
          const inCell = indexed.filter((a) => quadrantOf(a) === q.key)
          return (
            <div
              key={q.key}
              className={`rounded-xl border p-3 ${
                q.key === 'quickWin' ? 'border-accent/40 bg-accent-soft' : 'border-line bg-surface-2'
              }`}
            >
              <p className={`eyebrow ${q.key === 'quickWin' ? 'text-accent' : ''}`}>
                {t(`baStudio.q_${q.key}`)}
              </p>
              {inCell.length === 0 ? (
                <p className="mt-1 text-xs text-ink-faint">—</p>
              ) : (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {inCell.map((a) => (
                    <li key={a.index} className="text-xs leading-snug text-ink">
                      {a.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      <ul className="flex flex-col gap-2">
        {indexed.map((a) => (
          <li
            key={a.index}
            className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-line bg-surface-2 p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink">{a.text}</p>
              <p className="eyebrow mt-1 text-ink-faint">
                {t('baStudio.impact')} {a.impact} · {t('baStudio.effort')} {a.effort}
                {a.derived === false && ` · ${t('baStudio.aiEstimate')}`}
              </p>
            </div>
            {a.decision_id ? (
              <Link
                to="/decisions"
                className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-accent/40 bg-accent-soft px-2.5 py-1.5 text-xs font-semibold text-accent"
              >
                <ArrowUpRight size={13} aria-hidden="true" />
                {t('baStudio.viewDecision')}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => run(a.index)}
                disabled={busy !== null}
                className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-accent px-2.5 py-1.5 text-xs font-semibold text-bg transition hover:bg-accent-press disabled:opacity-50"
              >
                {busy === a.index ? (
                  <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Target size={13} aria-hidden="true" />
                )}
                {busy === a.index ? t('baStudio.promoting') : t('baStudio.promote')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
