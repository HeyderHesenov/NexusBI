import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Activity, FileText, LayoutDashboard, Sparkles, Target, Upload } from 'lucide-react'
import { SourceSelect } from '../components/datasource/SourceSelect'
import { useRequirementStore } from '../store/requirementStore'
import { useDatasourceStore } from '../store/datasourceStore'
import { useDashboardStore } from '../store/dashboardStore'
import { ImpactBadge } from '../components/decision/ImpactBadge'
import { FIELD } from '../components/ui/form'
import { formatNumber } from '../lib/format'
import { useFormatDate } from '../hooks/useFormatDate'
import { staleAsOf } from '../lib/trajectory'
import type { DecisionDirection, KpiItem } from '../types'


/** The acceptance criterion for one KPI: set it, then read the verdict.
 *
 *  Three states, deliberately distinguished — an unpromoted KPI, one whose
 *  baseline capture FAILED (measurable never, not measurable yet), and one that
 *  is actually being tracked. */
function CriterionRow({
  kpi,
  index,
  datasourceId,
  promoting,
  measuring,
  onPromote,
  onMeasure,
}: {
  kpi: KpiItem
  index: number
  datasourceId: string | null
  promoting: boolean
  measuring: boolean
  onPromote: (body: {
    kpi_index: number
    target_value: number
    direction: DecisionDirection | null
    datasource_id: string | null
  }) => Promise<void>
  onMeasure: (decisionId: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const fmtDate = useFormatDate()
  const [target, setTarget] = useState(kpi.target_value == null ? '' : String(kpi.target_value))
  const [direction, setDirection] = useState<string>(kpi.direction ?? '')

  // The whole row sits inside the <li>'s onClick, which toggles the KPI's
  // selection. Without this, typing a target or opening the select would also
  // deselect the KPI it belongs to.
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

  const outcome = kpi.outcome
  if (outcome) {
    const asOf = outcome.measured_at ? staleAsOf(outcome.measured_at, outcome.data_as_of) : undefined
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2" onClick={stop}>
        <ImpactBadge status={outcome.impact_status} />
        {outcome.baseline_value == null ? (
          <span className="text-xs text-ink-faint">{t('requirementsPage.baselineFailed')}</span>
        ) : (
          <>
            <span className="font-mono text-[11px] text-ink-soft">
              {t('requirementsPage.targetVsReal', {
                // '—', never 0: a null prediction rendered as "Hədəf 0" tells the
                // user the requirement demanded zero, which is a criterion nobody
                // wrote — the same fabrication the backend refuses to make.
                target:
                  outcome.predicted_value == null
                    ? '—'
                    : formatNumber(outcome.predicted_value, { compact: true, decimals: 2 }),
                real:
                  outcome.realized_value == null
                    ? '—'
                    : formatNumber(outcome.realized_value, { compact: true, decimals: 2 }),
              })}
            </span>
            <button
              onClick={() => onMeasure(outcome.decision_id)}
              disabled={measuring}
              className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-ink-soft transition hover:border-accent/40 hover:text-accent disabled:opacity-60"
            >
              <Activity size={12} />
              {measuring ? t('requirementsPage.measuring') : t('requirementsPage.measure')}
            </button>
            {asOf && (
              <span className="font-mono text-[10px] text-ink-faint">
                {t('decisionsPage.dataAsOf', { at: fmtDate(asOf, { mode: 'short' }) })}
              </span>
            )}
          </>
        )}
      </div>
    )
  }

  const parsed = Number(target)
  const ready = target.trim() !== '' && Number.isFinite(parsed)

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" onClick={stop}>
      <Target size={12} className="text-ink-faint" />
      <input
        type="number"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        placeholder={t('requirementsPage.targetPlaceholder')}
        aria-label={t('requirementsPage.criterionLabel')}
        className={`${FIELD} w-28`}
      />
      <select
        value={direction}
        onChange={(e) => setDirection(e.target.value)}
        aria-label={t('requirementsPage.directionLabel')}
        className={`${FIELD} w-32`}
      >
        <option value="">{t('requirementsPage.directionUnset')}</option>
        <option value="increase">{t('requirementsPage.directionIncrease')}</option>
        <option value="decrease">{t('requirementsPage.directionDecrease')}</option>
      </select>
      <button
        onClick={() =>
          onPromote({
            kpi_index: index,
            // Number, not the raw string: the API takes a float, and shipping a
            // string works only because Pydantic coerces it.
            target_value: parsed,
            direction: (direction || null) as DecisionDirection | null,
            datasource_id: datasourceId,
          })
        }
        disabled={promoting || !ready}
        className="inline-flex items-center gap-1 rounded-lg border border-accent/40 px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent-soft disabled:opacity-60"
      >
        {promoting ? t('requirementsPage.tracking') : t('requirementsPage.track')}
      </button>
      {!ready && <span className="text-[10px] text-ink-faint">{t('requirementsPage.noTargetHint')}</span>}
    </div>
  )
}

export function RequirementsPage() {
  const { t } = useTranslation()
  const SAMPLE = t('requirementsPage.sampleText')
  const navigate = useNavigate()
  const { doc, extracting, building, promoting, measuring, extract, build, promote, measureKpi, reset } =
    useRequirementStore()
  const { sources, load: loadSources } = useDatasourceStore()
  const dashStore = useDashboardStore()

  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [datasourceId, setDatasourceId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadSources().catch(() => undefined)
  }, [loadSources])

  // A source can vanish while this page is open: datasourceStore.remove()
  // filters the list and clears queryStore's selection, but it has no way to
  // know about this page's local state. SourceSelect would then hold a value
  // matching no option, which a browser renders as the first one ("Demo data")
  // while onBuild still posts the dead id. DatasourcePicker documents this bug;
  // sharing the picker did not share the guard, so /requirements still had it.
  //
  // Keyed on `sources`, not on the initial load: `datasourceId` starts null and
  // only becomes an id the user picked from a list that had already arrived, so
  // there is no "not loaded yet" state this can misread — and load() swaps the
  // whole array in a single set(), never blanking it first. Reconciling only
  // after the first load would be close to a no-op for the same reason.
  useEffect(() => {
    setDatasourceId((cur) => (cur && !sources.some((s) => s.id === cur) ? null : cur))
  }, [sources])

  // Select all KPIs by default whenever a fresh extraction arrives.
  useEffect(() => {
    if (doc) setSelected(new Set(doc.kpis.map((k) => k.question)))
  }, [doc?.id])

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setText(await file.text())
      if (!name) setName(file.name.replace(/\.[^.]+$/, ''))
    } catch {
      toast.error(t('requirementsPage.fileReadError'))
    }
  }

  const toggle = (q: string) =>
    setSelected((cur) => {
      const next = new Set(cur)
      next.has(q) ? next.delete(q) : next.add(q)
      return next
    })

  const chosen = useMemo(
    () => (doc?.kpis ?? []).filter((k) => selected.has(k.question)).map((k) => k.question),
    [doc, selected],
  )

  const onBuild = async () => {
    const dash = await build(datasourceId, chosen)
    if (dash) {
      await dashStore.loadList()
      await dashStore.open(dash.id)
      navigate('/dashboards')
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <header className="mb-6">
        <p className="eyebrow">{t('requirementsPage.eyebrow')}</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">{t('requirementsPage.title')}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {t('requirementsPage.subtitle')}
        </p>
      </header>

      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('requirementsPage.namePlaceholder')}
            className="flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm text-ink-soft transition hover:border-accent hover:text-ink">
            <Upload size={14} /> {t('requirementsPage.fileLabel')}
            <input type="file" accept=".txt,.md,.csv,text/*" className="hidden" onChange={onFile} />
          </label>
          <button
            onClick={() => setText(SAMPLE)}
            className="rounded-xl px-3 py-2 text-sm text-ink-faint transition hover:text-ink"
          >
            {t('requirementsPage.sampleButton')}
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={t('requirementsPage.textPlaceholder')}
          className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-sm leading-relaxed text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <div className="mt-3 flex justify-end gap-2">
          {doc && (
            <button
              onClick={() => {
                reset()
                setText('')
              }}
              className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink"
            >
              {t('requirementsPage.clear')}
            </button>
          )}
          <button
            onClick={() => extract(name, text)}
            disabled={extracting || !text.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
          >
            <Sparkles size={15} className={extracting ? 'animate-pulse' : ''} />
            {extracting ? t('requirementsPage.extracting') : t('requirementsPage.extractKpi')}
          </button>
        </div>
      </div>

      {doc && doc.kpis.length > 0 && (
        <div className="reveal mt-5 rounded-2xl border border-line bg-surface p-5">
          <div className="mb-3 flex items-center gap-2">
            <FileText size={16} className="text-accent" />
            <h2 className="font-display text-lg font-semibold text-ink">
              {t('requirementsPage.extractedKpis', { count: doc.kpis.length })}
            </h2>
          </div>
          <ul className="space-y-2">
            {doc.kpis.map((k, i) => {
              const on = selected.has(k.question)
              return (
                <li
                  // Keyed on the document too: CriterionRow seeds its target and
                  // direction with useState, which only runs at mount. On a plain
                  // index key a second extraction reuses the same instances, so
                  // the previous document's typed target survives into the new
                  // one and Track would promote a threshold written for another
                  // requirement.
                  key={`${doc.id}:${i}`}
                  onClick={() => toggle(k.question)}
                  className={`cursor-pointer rounded-xl border p-3 transition ${
                    on ? 'border-accent/40 bg-accent-soft' : 'border-line bg-surface-2'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={on}
                      readOnly
                      className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink">{k.name}</p>
                      <p className="text-sm text-ink-soft">{k.question}</p>
                      {k.requirement_ref && (
                        <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                          ↳ {k.requirement_ref}
                        </p>
                      )}
                      <CriterionRow
                        kpi={k}
                        index={i}
                        datasourceId={datasourceId}
                        promoting={promoting === `${doc.id}:${i}`}
                        measuring={measuring != null && measuring === k.decision_id}
                        onPromote={promote}
                        onMeasure={measureKpi}
                      />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <SourceSelect
              value={datasourceId}
              onChange={setDatasourceId}
              // One picker, TWO consumers: the dashboard build and the metric
              // source of every KPI tracked from this page. The label says both
              // because the second binding outlives the visit — DecisionUpdate
              // has no datasource_id, so only a promote whose baseline failed can
              // still rebind it.
              label={t('requirementsPage.sourceLabel')}
              demoLabel={t('requirementsPage.demoData')}
              sources={sources}
              // This card speaks the form dialect (rounded-xl, text-sm), not the
              // query console's toolbar dialect — a 30px control here would
              // recreate the very mismatch this component was extracted to fix.
              size="field"
            />
            <button
              onClick={onBuild}
              disabled={building || chosen.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
            >
              <LayoutDashboard size={15} />
              {building ? t('requirementsPage.building') : t('requirementsPage.buildDashboard', { count: chosen.length })}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
