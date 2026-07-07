import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bookmark,
  Dices,
  GitBranch,
  Layers,
  Save,
  SlidersHorizontal,
  Target,
  Trash2,
} from 'lucide-react'
import { evaluate } from '../api/metricTree'
import { GoalSeekPanel } from '../components/twin/GoalSeekPanel'
import { MetricTreeEditor } from '../components/twin/MetricTreeEditor'
import { MonteCarloPanel } from '../components/twin/MonteCarloPanel'
import { ScenarioCompare } from '../components/twin/ScenarioCompare'
import { TornadoChart } from '../components/twin/TornadoChart'
import { TwinSliders } from '../components/twin/TwinSliders'
import { WaterfallChart } from '../components/twin/WaterfallChart'
import { Field, FIELD, Select } from '../components/ui/form'
import { ModalShell } from '../components/ui/ModalShell'
import { formatMetricValue as fmt, formatSignedPct } from '../lib/format'
import { collectLeaves, recompute, sensitivity, waterfall } from '../lib/metricTreeMath'
import { useTwinStore } from '../store/twinStore'
import type { EvaluatedNode } from '../types'

const SENS_PCT = 10

type TwinMode = 'build' | 'simulate' | 'goal' | 'compare' | 'monte'
const MODES: { id: TwinMode; icon: typeof Target }[] = [
  { id: 'build', icon: GitBranch },
  { id: 'simulate', icon: SlidersHorizontal },
  { id: 'goal', icon: Target },
  { id: 'compare', icon: Layers },
  { id: 'monte', icon: Dices },
]

export function TwinPage() {
  const { t } = useTranslation()
  const [forest, setForest] = useState<EvaluatedNode[] | null>(null)
  const [rootId, setRootId] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [scenarioName, setScenarioName] = useState('')
  const [mode, setMode] = useState<TwinMode>('simulate')
  const {
    adjustments,
    scenarios,
    ranges,
    setAdjustment,
    setRange,
    clearRanges,
    clearAdjustments,
    saveScenario,
    loadScenario,
    deleteScenario,
    pruneToLeaves,
    pruneScenarios,
  } = useTwinStore()

  // Re-evaluate the forest from the server (initial load + after tree edits in
  // the "build" tab, so the simulator always reflects the current tree).
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

  useEffect(() => {
    refreshForest()
  }, [refreshForest])

  const root = useMemo(
    () => forest?.find((r) => r.id === rootId) ?? forest?.[0] ?? null,
    [forest, rootId],
  )
  const leaves = useMemo(() => (root ? collectLeaves(root) : []), [root])
  // Only THIS root's leaves count — adjustments made on another KPI must not
  // enable Save / show a delta badge here (cross-root state stays isolated).
  const activeCount = useMemo(
    () => leaves.filter((l) => adjustments[l.id] !== undefined).length,
    [leaves, adjustments],
  )
  // root.value (server-evaluated) is the single baseline everywhere: header,
  // waterfall first bar, tornado deltas. With no active levers the simulated
  // value IS the baseline — never let client/server float drift show through.
  const baseline = root ? root.value : 0
  const simulatedValue = useMemo(
    () => (root && activeCount ? recompute(root, adjustments).value : baseline),
    [root, adjustments, activeCount, baseline],
  )
  const steps = useMemo(
    () => (root ? waterfall(root, adjustments, leaves, baseline) : []),
    [root, adjustments, leaves, baseline],
  )
  const sens = useMemo(() => (root ? sensitivity(root, SENS_PCT, baseline) : []), [root, baseline])
  const rootScenarios = scenarios.filter((s) => s.rootId === (root?.id ?? ''))
  const deltaPct = baseline ? ((simulatedValue - baseline) / Math.abs(baseline)) * 100 : null

  return (
    <div className="mx-auto w-full max-w-5xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{t('twinPage.eyebrow')}</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">
            {t('twinPage.title')}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">{t('twinPage.subtitle')}</p>
        </div>
        {root && (
          <div className="flex items-center gap-2">
            {forest && forest.length > 1 && (
              <Select
                value={root.id}
                onChange={(e) => setRootId(e.target.value)}
                aria-label={t('twinPage.pickRoot')}
                options={forest.map((r) => ({ value: r.id, label: r.name }))}
              />
            )}
            <button
              type="button"
              onClick={() => setSaveOpen(true)}
              disabled={!activeCount}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-50"
            >
              <Save size={14} /> {t('twinPage.saveScenario')}
            </button>
          </div>
        )}
      </header>

      {forest === null ? (
        <div className="grid min-h-[50vh] place-items-center text-sm text-ink-faint">
          {t('common.loading')}
        </div>
      ) : (
        <>
          <div
            role="tablist"
            aria-label={t('twinPage.title')}
            className="mb-4 inline-flex flex-wrap gap-1 rounded-2xl border border-line bg-surface p-1"
          >
            {MODES.map(({ id, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={mode === id}
                onClick={() => setMode(id)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                  mode === id ? 'bg-accent text-bg' : 'text-ink-soft hover:text-ink'
                }`}
              >
                <Icon size={14} /> {t(`twinPage.tabs.${id}`)}
              </button>
            ))}
          </div>

          {mode === 'build' ? (
            <MetricTreeEditor onChange={refreshForest} />
          ) : !root || !leaves.length ? (
            <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
              <div>
                <GitBranch size={24} className="mx-auto text-ink-faint" />
                <p className="mt-3 font-display text-lg text-ink">{t('twinPage.emptyTitle')}</p>
                <p className="mt-1 text-sm text-ink-soft">{t('twinPage.emptyBody')}</p>
                <button
                  type="button"
                  onClick={() => setMode('build')}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press"
                >
                  {t('twinPage.goToTree')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {mode === 'simulate' && (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-4">
                    <div>
                      <p className="text-xs text-ink-faint">{t('twinPage.baseline')}</p>
                      <p className="font-mono text-2xl font-bold text-ink">{fmt(baseline)}</p>
                    </div>
                    <span className="text-2xl text-ink-faint">→</span>
                    <div>
                      <p className="text-xs text-ink-faint">{t('twinPage.result')}</p>
                      <p
                        className={`font-mono text-2xl font-bold ${
                          simulatedValue >= baseline ? 'text-accent' : 'text-[#D87C6B]'
                        }`}
                      >
                        {fmt(simulatedValue)}
                        {deltaPct !== null && activeCount > 0 && (
                          <span className="ml-2 text-sm font-medium">
                            ({formatSignedPct(deltaPct)})
                          </span>
                        )}
                      </p>
                    </div>
                    {rootScenarios.length > 0 && (
                      <div className="ml-auto flex flex-wrap items-center gap-1.5">
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
                              className="ml-0.5 inline-flex rounded-md p-0.5 text-ink-faint opacity-0 transition hover:text-[#D87C6B] focus-visible:opacity-100 group-hover:opacity-100"
                            >
                              <Trash2 size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-5">
                    <section className="rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
                      <TwinSliders
                        leaves={leaves}
                        adjustments={adjustments}
                        onChange={setAdjustment}
                        onClear={() => clearAdjustments(new Set(leaves.map((l) => l.id)))}
                      />
                    </section>
                    <div className="flex flex-col gap-4 lg:col-span-3">
                      <section className="rounded-2xl border border-line bg-surface p-5">
                        <p className="eyebrow mb-3">{t('twinPage.waterfall')}</p>
                        <WaterfallChart steps={steps} />
                      </section>
                      <section className="rounded-2xl border border-line bg-surface p-5">
                        <p className="eyebrow mb-3">{t('twinPage.tornado', { pct: SENS_PCT })}</p>
                        <TornadoChart rows={sens} pct={SENS_PCT} />
                      </section>
                    </div>
                  </div>
                </>
              )}

              {mode === 'goal' && (
                <GoalSeekPanel
                  root={root}
                  leaves={leaves}
                  baseline={baseline}
                  onApply={(leafId, pct) => {
                    setAdjustment(leafId, pct)
                    setMode('simulate')
                  }}
                />
              )}

              {mode === 'compare' && (
                <ScenarioCompare root={root} baseline={baseline} scenarios={rootScenarios} />
              )}

              {mode === 'monte' && (
                <MonteCarloPanel
                  root={root}
                  leaves={leaves}
                  baseline={baseline}
                  ranges={ranges}
                  onSetRange={setRange}
                  onClear={() => clearRanges(new Set(leaves.map((l) => l.id)))}
                />
              )}
            </>
          )}
        </>
      )}

      <ModalShell
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title={t('twinPage.saveScenario')}
      >
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
            <input
              id="twin-scenario-name"
              className={FIELD}
              value={scenarioName}
              maxLength={80}
              onChange={(e) => setScenarioName(e.target.value)}
            />
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
