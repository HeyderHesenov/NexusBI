import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Target } from 'lucide-react'
import { Field, FIELD, Select } from '../ui/form'
import { formatMetricValue as fmt } from '../../lib/format'
import { goalSeek } from '../../lib/twinAnalysis'
import { useTargetStore } from '../../store/targetStore'
import type { EvaluatedNode } from '../../types'

interface Props {
  root: EvaluatedNode
  leaves: EvaluatedNode[]
  baseline: number
  onApply: (leafId: string, pct: number) => void
}

/** Goal Seek: enter a target KPI, pick a lever, solve for the % change needed. */
export function GoalSeekPanel({ root, leaves, baseline, onApply }: Props) {
  const { t } = useTranslation()
  const targets = useTargetStore((s) => s.items)
  const loadTargets = useTargetStore((s) => s.load)
  const [leafId, setLeafId] = useState(leaves[0]?.id ?? '')
  const [target, setTarget] = useState('')
  // null = not solved yet · 'unreachable' = solved, no answer · object = solved.
  const [solved, setSolved] = useState<{ pct: number; reached: number; leafId: string } | 'unreachable' | null>(null)

  useEffect(() => {
    loadTargets().catch(() => undefined)
  }, [loadTargets])

  // Any edit to the inputs (or a KPI switch) invalidates the shown solution.
  useEffect(() => setSolved(null), [target, leafId, root.id])

  const leaf = useMemo(() => leaves.find((l) => l.id === leafId) ?? leaves[0], [leaves, leafId])

  const solve = () => {
    const goal = Number(target)
    if (!leaf || !target.trim() || Number.isNaN(goal)) return
    const r = goalSeek(root, leaf.id, goal)
    setSolved(r ? { ...r, leafId: leaf.id } : 'unreachable')
  }

  const result = solved && solved !== 'unreachable' ? solved : null
  const solvedLeaf = result && leaves.find((l) => l.id === result.leafId)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-line bg-surface p-5">
        <p className="eyebrow mb-1">{t('twinPage.goalSeek.title')}</p>
        <p className="mb-4 text-sm text-ink-soft">{t('twinPage.goalSeek.help')}</p>

        <Field id="goal-target" label={t('twinPage.goalSeek.targetLabel')}>
          <input
            id="goal-target"
            className={FIELD}
            inputMode="decimal"
            placeholder={fmt(baseline)}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </Field>

        {targets.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-ink-faint">{t('twinPage.goalSeek.fromTargets')}</span>
            {targets.map((tg) => (
              <button
                key={tg.id}
                type="button"
                onClick={() => setTarget(String(tg.target_value))}
                className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-soft transition hover:border-accent hover:text-ink"
              >
                {tg.name}: {fmt(tg.target_value)}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4">
          <Field id="goal-lever" label={t('twinPage.goalSeek.leverLabel')}>
            <Select
              id="goal-lever"
              value={leaf?.id ?? ''}
              onChange={(e) => setLeafId(e.target.value)}
              options={leaves.map((l) => ({ value: l.id, label: l.name }))}
            />
          </Field>
        </div>

        <button
          type="button"
          onClick={solve}
          disabled={!target}
          className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-50"
        >
          <Target size={14} /> {t('twinPage.goalSeek.solve')}
        </button>
      </section>

      <section className="flex flex-col justify-center rounded-2xl border border-line bg-surface p-5">
        {result ? (
          <div>
            <p className="eyebrow mb-3">{t('twinPage.goalSeek.result')}</p>
            <p className="text-sm text-ink-soft">
              {t('twinPage.goalSeek.moveLever', { lever: solvedLeaf?.name ?? '' })}
            </p>
            <p
              className={`mt-1 font-mono text-4xl font-bold ${
                result.pct >= 0 ? 'text-accent' : 'text-[#D87C6B]'
              }`}
            >
              {result.pct >= 0 ? '+' : ''}
              {result.pct}%
            </p>
            <p className="mt-2 font-mono text-sm text-ink-soft">
              {t('twinPage.result')}: {fmt(result.reached)}
            </p>
            <button
              type="button"
              onClick={() => onApply(result.leafId, result.pct)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-accent px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent-soft"
            >
              {t('twinPage.goalSeek.apply')}
            </button>
          </div>
        ) : (
          <p className="text-center text-sm text-ink-faint">
            {solved === 'unreachable' ? t('twinPage.goalSeek.unreachable') : t('twinPage.goalSeek.empty')}
          </p>
        )}
      </section>
    </div>
  )
}
