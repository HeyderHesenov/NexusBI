import { useTranslation } from 'react-i18next'
import type { MLModelInfo } from '../../types'
import { ConfusionMatrix } from './ConfusionMatrix'
import { Leaderboard } from './Leaderboard'
import { RegressionDiagnostics } from './RegressionDiagnostics'
import { WeightBars } from './WeightBars'

const CARD = 'rounded-2xl border border-line bg-surface-2 p-4'

/** k-fold mean ± std of the winning model, with a dot per fold — one holdout can
 *  flatter or punish, so the spread across folds is the honest signal. */
function CvSummary({ cv }: { cv: NonNullable<MLModelInfo['diagnostics']['cv']> }) {
  const { t } = useTranslation()
  const lo = Math.min(...cv.scores)
  const hi = Math.max(...cv.scores)
  const span = hi - lo || 1
  return (
    <div className={CARD}>
      <div className="flex items-baseline justify-between">
        <p className="eyebrow">{t('automl.cvTitle')}</p>
        <p className="text-xs text-ink-faint">{t('automl.cvFolds', { count: cv.folds })}</p>
      </div>
      <p className="mt-1 font-mono text-xl font-bold text-ink">
        {cv.mean.toFixed(3)}
        <span className="ml-1 text-sm font-normal text-ink-soft">± {cv.std.toFixed(3)}</span>
        <span className="ml-2 text-xs uppercase tracking-wide text-ink-faint">
          {t(`automl.metric_${cv.metric}`, cv.metric)}
        </span>
      </p>
      <div className="mt-3 flex items-end gap-1" title={cv.scores.map((s) => s.toFixed(3)).join(', ')}>
        {cv.scores.map((s, i) => (
          <span
            key={i}
            className="flex-1 rounded-sm bg-accent"
            style={{ height: `${8 + 24 * ((s - lo) / span)}px` }}
          />
        ))}
      </div>
    </div>
  )
}

/** The full diagnostics stack for the selected model. Every block is optional and
 *  self-hides, so a legacy model (no diagnostics) simply renders nothing. */
export function ModelDiagnostics({ model }: { model: MLModelInfo }) {
  const { t } = useTranslation()
  const d = model.diagnostics ?? {}
  const perm = d.permutation_importance ?? []
  const hasAny =
    (model.leaderboard?.length ?? 0) > 0 ||
    !!d.cv ||
    !!d.confusion ||
    !!d.actual_vs_predicted ||
    perm.length > 0
  if (!hasAny) return null

  return (
    <div className="flex flex-col gap-4">
      {model.leaderboard?.length > 0 && (
        <div className={CARD}>
          <Leaderboard entries={model.leaderboard} />
        </div>
      )}
      {d.cv && <CvSummary cv={d.cv} />}
      {d.confusion && (
        <div className={CARD}>
          <ConfusionMatrix cm={d.confusion} />
        </div>
      )}
      {d.actual_vs_predicted && (
        <div className={CARD}>
          <RegressionDiagnostics avp={d.actual_vs_predicted} />
        </div>
      )}
      {perm.length > 0 && (
        <div className={CARD}>
          <WeightBars title={t('automl.permImportanceTitle')} items={perm} />
        </div>
      )}
    </div>
  )
}
