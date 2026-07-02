import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { BrainCircuit, Loader2, Sparkles } from 'lucide-react'
import { Field, FIELD, Select } from '../components/ui/form'
import { SavedCard } from '../components/ui/SavedCard'
import { useOpenParam } from '../hooks/useOpenParam'
import { useAutoMLStore } from '../store/automlStore'
import { formatMetricValue as fmt } from '../lib/format'
import type { AutoMLTable, MLModelInfo } from '../types'

const isIdish = (c: string) => c.toLowerCase() === 'id' || c.toLowerCase().endsWith('_id')

function ImportanceBars({ model }: { model: MLModelInfo }) {
  const { t } = useTranslation()
  const top = model.importances.slice(0, 10)
  const max = Math.max(...top.map((i) => i.weight), 0.0001)
  return (
    <div>
      <p className="eyebrow mb-2">{t('automl.importance')}</p>
      <div className="flex flex-col gap-1.5">
        {top.map((i) => (
          <div key={i.feature} className="flex items-center gap-2 text-xs">
            <span className="w-40 truncate text-ink-soft" title={i.feature}>
              {i.feature}
            </span>
            <span className="h-2 flex-1 rounded-full bg-surface-2">
              <span
                className="block h-2 rounded-full bg-accent"
                style={{ width: `${(i.weight / max) * 100}%` }}
              />
            </span>
            <span className="w-12 text-right font-mono text-ink-faint">
              {Math.round(i.weight * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PredictForm({ model, table }: { model: MLModelInfo; table: AutoMLTable | undefined }) {
  const { t } = useTranslation()
  const { predict, predictions } = useAutoMLStore()
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const inputCols = useMemo(
    () =>
      (table?.columns ?? []).filter(
        (c) => c.name !== model.target_column && !isIdish(c.name),
      ),
    [table, model.target_column],
  )
  if (!inputCols.length) return null

  const numeric = (dtype: string) => /INT|NUM|REAL|FLOAT|DEC/i.test(dtype)
  const hasInput = inputCols.some((c) => (values[c.name] ?? '') !== '')

  const onPredict = async () => {
    const row: Record<string, unknown> = {}
    for (const c of inputCols) {
      const v = values[c.name] ?? ''
      if (v === '') continue
      row[c.name] = numeric(c.dtype) ? Number(v) : v
    }
    setBusy(true)
    try {
      await predict([row])
    } catch {
      /* interceptor shows the API error */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-4">
      <p className="eyebrow mb-3">{t('automl.predictTitle')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {inputCols.map((c) => (
          <Field key={c.name} id={`ml-in-${c.name}`} label={c.name}>
            <input
              id={`ml-in-${c.name}`}
              className={FIELD}
              type={numeric(c.dtype) ? 'number' : 'text'}
              value={values[c.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [c.name]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onPredict}
          disabled={busy || !hasInput}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {t('automl.predict')}
        </button>
        {predictions !== null && predictions.length > 0 && (
          <p className="text-sm text-ink">
            {model.target_column} ≈{' '}
            <span className="font-mono text-lg font-bold text-accent">
              {typeof predictions[0] === 'number' ? fmt(predictions[0]) : String(predictions[0])}
            </span>
          </p>
        )}
      </div>
    </div>
  )
}

export function AutoMLPage() {
  const { t } = useTranslation()
  const {
    tables, models, training, sourceTable, targetColumn, current,
    load, pickSource, pickTarget, train, select, remove,
  } = useAutoMLStore()
  const [name, setName] = useState('')
  // Deep-link from the copilot chip: /automl?open=<model_id>
  useOpenParam(load, select)

  const table = tables.find((tb) => tb.name === sourceTable)
  const currentTable = tables.find((tb) => tb.name === current?.source_table)
  const targetOptions = (table?.columns ?? []).filter((c) => !isIdish(c.name))

  const onTrain = async () => {
    try {
      await train(name)
      toast.success(t('automl.trained'))
      setName('')
    } catch {
      /* interceptor shows the API error */
    }
  }

  return (
    <div className="w-full">
      <header className="mb-6">
        <p className="eyebrow">{t('automl.eyebrow')}</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">
          {t('automl.title')}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">{t('automl.subtitle')}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* wizard */}
        <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 lg:col-span-2 lg:self-start">
          {training ? (
            <div className="grid min-h-[220px] place-items-center text-center">
              <div>
                <Loader2 size={22} className="mx-auto animate-spin text-accent" />
                <p className="mt-3 text-sm text-ink-soft">{t('automl.training')}</p>
              </div>
            </div>
          ) : (
            <>
              <Field id="ml-table" label={t('automl.sourceLabel')} hint={t('automl.sourceHint')}>
                <Select
                  id="ml-table"
                  value={sourceTable ?? ''}
                  onChange={(e) => pickSource(e.target.value)}
                  options={[
                    { value: '', label: t('automl.pickTable') },
                    ...tables.map((tb) => ({ value: tb.name, label: tb.name })),
                  ]}
                />
              </Field>
              {sourceTable && (
                <>
                  <Field id="ml-target" label={t('automl.targetLabel')}>
                    <Select
                      id="ml-target"
                      value={targetColumn ?? ''}
                      onChange={(e) => pickTarget(e.target.value)}
                      options={[
                        { value: '', label: t('automl.pickTarget') },
                        ...targetOptions.map((c) => ({
                          value: c.name,
                          label: `${c.name} (${c.dtype})`,
                        })),
                      ]}
                    />
                  </Field>
                  <Field id="ml-name" label={t('automl.nameLabel')}>
                    <input
                      id="ml-name"
                      className={FIELD}
                      value={name}
                      maxLength={255}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={sourceTable && targetColumn ? `${sourceTable}.${targetColumn}` : ''}
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={onTrain}
                    disabled={!targetColumn}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-50"
                  >
                    <BrainCircuit size={15} /> {t('automl.train')}
                  </button>
                </>
              )}
            </>
          )}
        </section>

        {/* result */}
        <section className="rounded-2xl border border-line bg-surface p-5 lg:col-span-3">
          {current ? (
            <div className="flex flex-col gap-4">
              <div>
                <p className="eyebrow">
                  {t(`automl.type_${current.problem_type}`)} · {current.best_algo} ·{' '}
                  {t('automl.rows', { count: current.row_count })}
                </p>
                <h2 className="font-display text-lg font-bold text-ink">{current.name}</h2>
              </div>
              <div className="flex flex-wrap gap-3">
                {Object.entries(current.metrics).map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-line bg-surface-2 px-4 py-2">
                    <p className="text-xs text-ink-faint">{t(`automl.metric_${k}`)}</p>
                    <p className="font-mono text-xl font-bold text-ink">
                      {Math.round(v * 1000) / 1000}
                    </p>
                  </div>
                ))}
              </div>
              <ImportanceBars model={current} />
              {/* key: a model switch must remount the form — stale inputs from
                  another table's columns must not leak into this prediction */}
              <PredictForm key={current.id} model={current} table={currentTable} />
            </div>
          ) : (
            <div className="plot-grid grid min-h-[45vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
              <div>
                <BrainCircuit size={24} className="mx-auto text-ink-faint" />
                <p className="mt-3 font-display text-lg text-ink">{t('automl.emptyTitle')}</p>
                <p className="mt-1 text-sm text-ink-soft">{t('automl.emptyBody')}</p>
              </div>
            </div>
          )}
        </section>
      </div>

      {models.length > 0 && (
        <section className="mt-6">
          <p className="eyebrow mb-3">{t('automl.savedModels')}</p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {models.map((m) => (
              <li key={m.id} className="group">
                <SavedCard
                  active={current?.id === m.id}
                  title={m.name}
                  subtitle={`${t(`automl.type_${m.problem_type}`)} · ${new Date(m.created_at).toLocaleDateString()}`}
                  deleteLabel={t('automl.delete')}
                  onSelect={() => select(m.id)}
                  onDelete={() =>
                    remove(m.id).then(() => toast.success(t('automl.deleted'))).catch(() => undefined)
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
