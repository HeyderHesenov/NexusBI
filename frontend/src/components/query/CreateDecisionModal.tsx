import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModalShell } from '../ui/ModalShell'
import { Field, FIELD, Select } from '../ui/form'
import { useDecisionStore } from '../../store/decisionStore'
import type { DecisionCadence, DecisionDirection } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  insight: string
  queryLogId: string | null
  question?: string
  datasourceId?: string | null
}

export function CreateDecisionModal({ open, onClose, insight, queryLogId, question, datasourceId }: Props) {
  const { t } = useTranslation()
  const add = useDecisionStore((s) => s.add)
  const [title, setTitle] = useState('')
  const [action, setAction] = useState('')
  const [track, setTrack] = useState(false)
  const [metricColumn, setMetricColumn] = useState('')
  const [predicted, setPredicted] = useState('')
  const [direction, setDirection] = useState<DecisionDirection>('increase')
  const [cadence, setCadence] = useState<DecisionCadence>('off')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      await add({
        title: title.trim(),
        insight,
        action: action.trim(),
        query_log_id: queryLogId,
        ...(track && {
          metric_query: question || null,
          metric_column: metricColumn.trim() || null,
          datasource_id: datasourceId ?? null,
          predicted_value: predicted.trim() ? Number(predicted) : null,
          predicted_direction: direction,
          measure_cadence: cadence,
        }),
      })
      setTitle('')
      setAction('')
      setTrack(false)
      setMetricColumn('')
      setPredicted('')
      onClose()
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={t('createDecisionModal.title')}
      subtitle={t('createDecisionModal.subtitle')}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink">
            {t('createDecisionModal.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
          >
            {t('createDecisionModal.create')}
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {insight && (
          <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-soft">
            {insight}
          </p>
        )}
        <Field id="dec-title" label={t('createDecisionModal.titleLabel')}>
          <input
            id="dec-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('createDecisionModal.titlePlaceholder')}
            className={FIELD}
          />
        </Field>
        <Field id="dec-action" label={t('createDecisionModal.actionLabel')}>
          <input
            id="dec-action"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder={t('createDecisionModal.actionPlaceholder')}
            className={FIELD}
          />
        </Field>

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-3">
          <span className="text-sm font-medium text-ink">{t('createDecisionModal.trackLabel')}</span>
          <input
            type="checkbox"
            checked={track}
            onChange={(e) => setTrack(e.target.checked)}
            className="peer sr-only"
          />
          <span className="relative h-5 w-9 shrink-0 rounded-full bg-line transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-surface after:shadow-sm after:transition-transform peer-checked:bg-accent peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50" />
        </label>

        {track && (
          <div className="space-y-3 rounded-xl border border-line bg-surface-2/50 p-3.5">
            <p className="text-xs text-ink-faint">{t('createDecisionModal.baselineHint')}</p>
            <Field id="dec-metric-col" label={t('createDecisionModal.metricColumnLabel')}>
              <input
                id="dec-metric-col"
                value={metricColumn}
                onChange={(e) => setMetricColumn(e.target.value)}
                placeholder={t('createDecisionModal.metricColumnPlaceholder')}
                className={FIELD}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="dec-predicted" label={t('createDecisionModal.predictedLabel')}>
                <input
                  id="dec-predicted"
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={predicted}
                  onChange={(e) => setPredicted(e.target.value)}
                  placeholder={t('createDecisionModal.predictedPlaceholder')}
                  className={FIELD}
                />
              </Field>
              <Field id="dec-direction" label={t('createDecisionModal.directionLabel')}>
                <Select
                  id="dec-direction"
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as DecisionDirection)}
                  options={[
                    { value: 'increase', label: t('createDecisionModal.directionIncrease') },
                    { value: 'decrease', label: t('createDecisionModal.directionDecrease') },
                  ]}
                />
              </Field>
            </div>
            <Field id="dec-cadence" label={t('createDecisionModal.cadenceLabel')}>
              <Select
                id="dec-cadence"
                value={cadence}
                onChange={(e) => setCadence(e.target.value as DecisionCadence)}
                options={[
                  { value: 'off', label: t('createDecisionModal.cadenceOff') },
                  { value: 'daily', label: t('createDecisionModal.cadenceDaily') },
                  { value: 'weekly', label: t('createDecisionModal.cadenceWeekly') },
                ]}
              />
            </Field>
          </div>
        )}
      </div>
    </ModalShell>
  )
}
