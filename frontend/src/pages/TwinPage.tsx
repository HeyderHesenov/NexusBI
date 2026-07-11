import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bookmark, Dices, GitBranch, Save, SlidersHorizontal, Target, Trash2 } from 'lucide-react'
import { evaluate } from '../api/metricTree'
import { GoalSeekPanel } from '../components/twin/GoalSeekPanel'
import { MetricTreeEditor } from '../components/twin/MetricTreeEditor'
import { MonteCarloPanel } from '../components/twin/MonteCarloPanel'
import { ScenarioCompare } from '../components/twin/ScenarioCompare'
import { TornadoChart } from '../components/twin/TornadoChart'
import { TwinKpiHero } from '../components/twin/TwinKpiHero'
import { TwinSliders } from '../components/twin/TwinSliders'
import { WaterfallChart } from '../components/twin/WaterfallChart'
import { DANGER } from '../components/charts/theme'
import { Field, FIELD, Select } from '../components/ui/form'
import { ModalShell } from '../components/ui/ModalShell'
import { formatMetricValue as fmt } from '../lib/format'
import { collectLeaves, recompute, sensitivity, waterfall } from '../lib/metricTreeMath'
import { activeRanges, monteCarlo } from '../lib/twinAnalysis'
import { buildNarrative, scenarioPacing } from '../lib/twinNarrative'
import { useTargetStore } from '../store/targetStore'
import { useTwinStore } from '../store/twinStore'
import type { EvaluatedNode } from '../types'

const SENS_PCT = 10
const MC_ITERATIONS = 2000

type TwinMode = 'model' | 'simulate' | 'risk'
const MODES: { id: TwinMode; icon: typeof Target }[] = [
  { id: 'model', icon: GitBranch },
  { id: 'simulate', icon: SlidersHorizontal },
  { id: 'risk', icon: Dices },
]

export function TwinPage() {
  const { t } = useTranslation()
  const [forest, setForest] = useState<EvaluatedNode[] | null>(null)
  const [rootId, setRootId] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [scenarioName, setScenarioName] = useState('')
  const [mode, setMode] = useState<TwinMode>('simulate')
  const [targetId, setTargetId] = useState('')
  const [showGoal, setShowGoal] = useState(false)

  const targets = useTargetStore((s) => s.items)
  const loadTargets = useTargetStore((s) => s.load)
  const {
    adjustments, scenarios, ranges,
    setAdjustment, setRange, clearRanges, clearAdjustments,
    saveScenario, loadScenario, deleteScenario, pruneToLeaves, pruneScenarios,
  } = useTwinStore()

  const refreshForest = useCallback(() => {
    evaluate()
      .then((f) => {
        setForest(f)
        setRootId((cur) => cur ?? f[0]?.id ?? null)
        pruneToLeaves(new Set(f.flatMap(collectLeaves).map((l) => l.id)))
        pruneScenarios(new Set(f.map((r) => r.id)))
      })
      .catch(() => setForest([]))
  }, [pruneToLeaves, pruneScenarios])

  useEffect(() => { refreshForest() }, [refreshForest])
  useEffect(() => { loadTargets().catch(() => undefined) }, [loadTargets])

  const root = useMemo(() => forest?.find((r) => r.id === rootId) ?? forest?.[0] ?? null, [forest, rootId])
  const leaves = useMemo(() => (root ? collectLeaves(root) : []), [root])
  const activeCount = useMemo(
    () => leaves.filter((l) => adjustments[l.id] !== undefined).length,
    [leaves, adjustments],
  )
  const baseline = root ? root.value : 0
  const simulatedValue = useMemo(
    () => (root && activeCount ? recompute(root, adjustments).value : baseline),
    [root, adjustments, activeCount, baseline],
  )
  const steps = useMemo(() => (root ? waterfall(root, adjustments, leaves, baseline) : []), [root, adjustments, leaves, baseline])
  const sens = useMemo(() => (root ? sensitivity(root, SENS_PCT, baseline) : []), [root, baseline])
  const rootScenarios = scenarios.filter((s) => s.rootId === (root?.id ?? ''))
  const deltaPct = baseline ? ((simulatedValue - baseline) / Math.abs(baseline)) * 100 : null
  const narrative = useMemo(
    () => (root && activeCount ? buildNarrative(root, adjustments, leaves, baseline) : null),
    [root, adjustments, leaves, baseline, activeCount],
  )
  // P10–P90 for the hero, only when Monte Carlo ranges are set (Risk surface).
  const uncertainty = useMemo(() => {
    const active = root ? activeRanges(leaves, ranges) : {}
    if (!root || !Object.keys(active).length) return null
    const r = monteCarlo(root, active, baseline, { iterations: MC_ITERATIONS, seed: 1 })
    return { p10: r.p10, p90: r.p90 }
  }, [root, leaves, ranges, baseline])
  const linkedTarget = targets.find((tg) => tg.id === targetId) ?? null
  const pacing = linkedTarget ? scenarioPacing(simulatedValue, linkedTarget) : null

  return (
    <div className="mx-auto w-full max-w-7xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{t('twinPage.eyebrow')}</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">{t('twinPage.title')}</h1>
          <p className="mt-1 text-sm text-ink-soft">{t('twinPage.subtitle')}</p>
        </div>
        {root && forest && forest.length > 1 && (
          <Select
            value={root.id}
            onChange={(e) => setRootId(e.target.value)}
            aria-label={t('twinPage.pickRoot')}
            options={forest.map((r) => ({ value: r.id, label: r.name }))}
          />
        )}
      </header>

      {forest === null ? (
        <div className="grid min-h-[50vh] place-items-center text-sm text-ink-faint">{t('common.loading')}</div>
      ) : (
        <>
          <div role="tablist" aria-label={t('twinPage.title')} className="mb-5 inline-flex flex-wrap gap-1 rounded-2xl border border-line bg-surface p-1">
            {MODES.map(({ id, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={mode === id}
                onClick={() => setMode(id)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition ${
                  mode === id ? 'bg-accent text-bg' : 'text-ink-soft hover:text-ink'
                }`}
              >
                <Icon size={14} /> {t(`twinPage.tabs.${id}`)}
              </button>
            ))}
          </div>

          {mode === 'model' ? (
            <MetricTreeEditor onChange={refreshForest} />
          ) : !root || !leaves.length ? (
            <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
              <div>
                <GitBranch size={24} className="mx-auto text-ink-faint" />
                <p className="mt-3 font-display text-lg text-ink">{t('twinPage.emptyTitle')}</p>
                <p className="mt-1 text-sm text-ink-soft">{t('twinPage.emptyBody')}</p>
                <button
                  type="button"
                  onClick={() => setMode('model')}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press"
                >
                  {t('twinPage.goToTree')}
                </button>
              </div>
            </div>
          ) : mode === 'risk' ? (
            <MonteCarloPanel
              root={root}
              leaves={leaves}
              baseline={baseline}
              ranges={ranges}
              onSetRange={setRange}
              onClear={() => clearRanges(new Set(leaves.map((l) => l.id)))}
            />
          ) : (
            /* ── Simulyator ── */
            <div className="flex flex-col gap-5">
              <div className="reveal">
                <TwinKpiHero
                  baseline={baseline}
                  simulated={simulatedValue}
                  deltaPct={deltaPct}
                  points={steps.map((s) => s.to)}
                  active={activeCount > 0}
                  uncertainty={uncertainty}
                  pacing={pacing}
                  target={linkedTarget ? { name: linkedTarget.name, value: linkedTarget.target_value } : null}
                />
              </div>

              {(targets.length > 0 || narrative) && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {narrative && narrative.deltaPct !== null ? (
                    <p className="text-sm text-ink-soft">
                      <span className="text-ink-faint">{t('twinPage.narrative.lead')}:</span>{' '}
                      {narrative.drivers.slice(0, 3).map((d, i) => (
                        <span key={d.id} className="text-ink">
                          {i > 0 ? ', ' : ''}
                          {d.name}{' '}
                          <span style={d.pct >= 0 ? undefined : { color: DANGER }} className={d.pct >= 0 ? 'text-accent' : ''}>
                            ({d.pct > 0 ? '+' : ''}{d.pct}%)
                          </span>
                        </span>
                      ))}
                    </p>
                  ) : <span />}
                  {targets.length > 0 && (
                    <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
                      <Target size={14} className="text-ink-faint" />
                      {t('twinPage.linkTarget')}
                      <Select
                        value={targetId}
                        onChange={(e) => setTargetId(e.target.value)}
                        aria-label={t('twinPage.linkTarget')}
                        options={[
                          { value: '', label: t('twinPage.noTargetOption') },
                          ...targets.map((tg) => ({ value: tg.id, label: `${tg.name} · ${fmt(tg.target_value)}` })),
                        ]}
                      />
                    </label>
                  )}
                </div>
              )}

              <div className="grid gap-5 lg:grid-cols-5">
                <section className="rounded-2xl border border-line bg-surface p-5 shadow-card lg:col-span-2">
                  <TwinSliders
                    leaves={leaves}
                    adjustments={adjustments}
                    onChange={setAdjustment}
                    onClear={() => clearAdjustments(new Set(leaves.map((l) => l.id)))}
                  />
                </section>
                <div className="flex flex-col gap-5 lg:col-span-3">
                  <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                    <p className="eyebrow mb-3">{t('twinPage.waterfall')}</p>
                    <WaterfallChart steps={steps} />
                  </section>
                  <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                    <p className="eyebrow mb-3">{t('twinPage.tornado', { pct: SENS_PCT })}</p>
                    <TornadoChart rows={sens} pct={SENS_PCT} />
                  </section>
                </div>
              </div>

              {/* Scenarios: save, chips, and inline compare */}
              <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="eyebrow">{t('twinPage.scenariosTitle')}</p>
                  <button
                    type="button"
                    onClick={() => setSaveOpen(true)}
                    disabled={!activeCount}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-50"
                  >
                    <Save size={14} /> {t('twinPage.saveScenario')}
                  </button>
                </div>
                {rootScenarios.length === 0 ? (
                  <p className="text-sm text-ink-faint">{t('twinPage.compare.emptyBody')}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Bookmark size={13} className="text-ink-faint" />
                      {rootScenarios.map((sc) => (
                        <span key={sc.id} className="group inline-flex items-center">
                          <button
                            type="button"
                            onClick={() => loadScenario(sc.id, new Set(leaves.map((l) => l.id)))}
                            className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-soft transition hover:border-accent hover:text-ink"
                          >
                            {sc.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteScenario(sc.id)}
                            aria-label={t('twinPage.deleteScenario')}
                            className="ml-0.5 inline-flex rounded-md p-0.5 text-ink-faint opacity-0 transition hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
                          >
                            <Trash2 size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                    {rootScenarios.length >= 2 && (
                      <div className="mt-4">
                        <ScenarioCompare root={root} baseline={baseline} scenarios={rootScenarios} />
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* Goal seek — lightweight, on demand */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowGoal((v) => !v)}
                  aria-expanded={showGoal}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
                    showGoal ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:border-accent hover:text-ink'
                  }`}
                >
                  <Target size={14} /> {t('twinPage.goalSeek.title')}
                </button>
                {showGoal && (
                  <div className="mt-4">
                    <GoalSeekPanel
                      root={root}
                      leaves={leaves}
                      baseline={baseline}
                      onApply={(leafId, pct) => { setAdjustment(leafId, pct); setShowGoal(false) }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <ModalShell open={saveOpen} onClose={() => setSaveOpen(false)} title={t('twinPage.saveScenario')}>
        <form
          className="p-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (scenarioName.trim() && root) {
              saveScenario(scenarioName, root.id, new Set(leaves.map((l) => l.id)))
              setScenarioName('')
              setSaveOpen(false)
            }
          }}
        >
          <Field id="twin-scenario-name" label={t('twinPage.scenarioName')}>
            <input id="twin-scenario-name" className={FIELD} value={scenarioName} maxLength={80} onChange={(e) => setScenarioName(e.target.value)} />
          </Field>
          <button
            type="submit"
            disabled={!scenarioName.trim()}
            className="mt-4 w-full rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-50"
          >
            {t('twinPage.save')}
          </button>
        </form>
      </ModalShell>
    </div>
  )
}
