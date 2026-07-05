import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Database, Filter, Grid3x3, Play, RefreshCw } from 'lucide-react'
import { useCohortStore } from '../store/cohortStore'
import { useDatasourceStore } from '../store/datasourceStore'
import { CohortHeatmap } from '../components/charts/CohortHeatmap'
import { FunnelChart } from '../components/charts/FunnelChart'
import { Field, Select } from '../components/ui/form'

type Tab = 'retention' | 'funnel'

const TABS: { key: Tab; labelKey: string; Icon: typeof Grid3x3 }[] = [
  { key: 'retention', labelKey: 'cohortPage.tabRetention', Icon: Grid3x3 },
  { key: 'funnel', labelKey: 'cohortPage.tabFunnel', Icon: Filter },
]

export function CohortPage() {
  const { t } = useTranslation()
  const { retention, funnel, loading, error, load } = useCohortStore()
  const { sources, schemas, load: loadSources, loadSchema } = useDatasourceStore()
  const [tab, setTab] = useState<Tab>('retention')

  // Column mapping — empty datasource ('') means demo, which needs no mapping.
  const [dsId, setDsId] = useState('')
  const [table, setTable] = useState('')
  const [entityCol, setEntityCol] = useState('')
  const [dateCol, setDateCol] = useState('')
  const [stageCol, setStageCol] = useState('')
  // In real mode the charts stay hidden (still holding demo data) until Run.
  const [ranReal, setRanReal] = useState(false)

  useEffect(() => {
    loadSources().catch(() => undefined)
    void load() // demo on first paint
  }, [loadSources, load])

  const schema = dsId ? schemas[dsId] : undefined
  const tables = useMemo(() => (schema ? Object.keys(schema) : []), [schema])
  const columns = useMemo(() => (schema && table ? schema[table].map((c) => c.name) : []), [schema, table])

  const resetMapping = () => {
    setTable('')
    setEntityCol('')
    setDateCol('')
    setStageCol('')
    setRanReal(false)
  }

  const onPickDatasource = (id: string) => {
    setDsId(id)
    resetMapping()
    if (id) loadSchema(id).catch(() => undefined)
    else void load() // back to demo
  }

  const isDemo = !dsId
  // Retention needs entity+date, funnel needs entity+stage — allow either.
  const mapped = Boolean(table && entityCol && (dateCol || stageCol))

  const runReal = () => {
    setRanReal(true)
    void load({
      datasource_id: dsId,
      table,
      entity_col: entityCol,
      date_col: dateCol,
      stage_col: stageCol,
    })
  }

  const colOptions = [
    { value: '', label: t('cohortPage.pickColumn') },
    ...columns.map((c) => ({ value: c, label: c })),
  ]

  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="mb-5">
        <p className="eyebrow">{t('cohortPage.eyebrow')}</p>
        <div className="mt-1 flex items-center gap-2.5">
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink">
            {t('cohortPage.title')}
          </h1>
          {isDemo && (
            <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-faint">
              {t('common.demoMode')}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-ink-soft">{t('cohortPage.subtitle')}</p>
      </header>

      {/* Data source + column mapping */}
      <section className="mb-4 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <Field id="cohort-datasource" label={t('cohortPage.dataSource')}>
              <Select
                id="cohort-datasource"
                value={dsId}
                onChange={(e) => onPickDatasource(e.target.value)}
                options={[
                  { value: '', label: t('cohortPage.demoData') },
                  ...sources.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </Field>
          </div>
          {!isDemo && (
            <div className="min-w-[160px] flex-1">
              <Field id="cohort-table" label={t('cohortPage.table')}>
                <Select
                  id="cohort-table"
                  value={table}
                  onChange={(e) => {
                    setTable(e.target.value)
                    setEntityCol('')
                    setDateCol('')
                    setStageCol('')
                    setRanReal(false)
                  }}
                  options={[
                    { value: '', label: t('cohortPage.pickTable') },
                    ...tables.map((tb) => ({ value: tb, label: tb })),
                  ]}
                />
              </Field>
            </div>
          )}
        </div>

        {isDemo ? (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-faint">
            <Database size={13} /> {t('cohortPage.demoHint')}
          </p>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field id="cohort-entity" label={t('cohortPage.entityCol')} hint={t('cohortPage.entityHint')}>
                <Select id="cohort-entity" value={entityCol} onChange={(e) => { setEntityCol(e.target.value); setRanReal(false) }} options={colOptions} disabled={!table} />
              </Field>
              <Field id="cohort-date" label={t('cohortPage.dateCol')} hint={t('cohortPage.dateHint')}>
                <Select id="cohort-date" value={dateCol} onChange={(e) => { setDateCol(e.target.value); setRanReal(false) }} options={colOptions} disabled={!table} />
              </Field>
              <Field id="cohort-stage" label={t('cohortPage.stageCol')} hint={t('cohortPage.stageHint')}>
                <Select id="cohort-stage" value={stageCol} onChange={(e) => { setStageCol(e.target.value); setRanReal(false) }} options={colOptions} disabled={!table} />
              </Field>
            </div>
            <button
              type="button"
              onClick={runReal}
              disabled={!mapped || loading}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-50"
            >
              <Play size={14} /> {t('cohortPage.run')}
            </button>
          </>
        )}
      </section>

      <div className="mb-4 flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
        {TABS.map(({ key, labelKey, Icon }) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === key ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:text-ink'
            }`}
          >
            <Icon size={14} />
            {t(labelKey)}
          </button>
        ))}
      </div>

      <section className="rounded-2xl border border-line bg-surface p-5">
        {loading ? (
          <div className="grid min-h-[40vh] place-items-center text-sm text-ink-faint">
            {t('common.loading')}
          </div>
        ) : !isDemo && !ranReal ? (
          <div className="grid min-h-[40vh] place-items-center text-center text-sm text-ink-soft">
            {t('cohortPage.mapPrompt')}
          </div>
        ) : error && !retention ? (
          <div className="grid min-h-[40vh] place-items-center text-center">
            <div>
              <p className="text-sm text-ink-soft">{t('cohortPage.error')}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
              >
                <RefreshCw size={14} />
                {t('common.retry')}
              </button>
            </div>
          </div>
        ) : tab === 'retention' ? (
          <>
            <p className="mb-4 text-xs text-ink-faint">{t('cohortPage.retentionHint')}</p>
            {retention ? (
              <CohortHeatmap data={retention} />
            ) : (
              <p className="text-sm text-ink-soft">{t('cohortPage.empty')}</p>
            )}
          </>
        ) : (
          <>
            <p className="mb-4 text-xs text-ink-faint">{t('cohortPage.funnelHint')}</p>
            <FunnelChart steps={funnel} />
          </>
        )}
      </section>
    </div>
  )
}
