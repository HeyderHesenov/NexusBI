import { AlertTriangle, Download, GitBranch, GitFork, ShieldCheck, SlidersHorizontal, Tags, TrendingUp, Workflow, Wrench, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AnomalyResult,
  ChartConfig,
  ChartType,
  CausalResult,
  ForecastResult,
  Lineage,
  RootCauseResult,
  SignificanceResult,
} from '../../types'
import { downloadCsv } from '../../lib/csv'
import { matchTarget, targetValueFor } from '../../lib/kpiTargets'
import { useKpiTargets } from '../../hooks/useKpiTargets'
import * as analysisApi from '../../api/analysis'
// AI analysis panels load on demand — none render until the user clicks their
// button, so they stay out of the query/dashboard initial chunk.
const AnomalyPanel = lazy(() => import('./AnomalyPanel').then((m) => ({ default: m.AnomalyPanel })))
const RootCausePanel = lazy(() =>
  import('./RootCausePanel').then((m) => ({ default: m.RootCausePanel })),
)
const LineagePanel = lazy(() => import('./LineagePanel').then((m) => ({ default: m.LineagePanel })))
const StatsGuardPanel = lazy(() =>
  import('./StatsGuardPanel').then((m) => ({ default: m.StatsGuardPanel })),
)
const CausalPanel = lazy(() => import('./CausalPanel').then((m) => ({ default: m.CausalPanel })))
const ScenarioPanel = lazy(() =>
  import('./ScenarioPanel').then((m) => ({ default: m.ScenarioPanel })),
)
import { ActionMenu, type ActionMenuSection } from '../ui/ActionMenu'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { ChartRenderer } from './LazyChartRenderer'
import { ChartZoom } from './ChartZoom'
import { ChartFullscreenModal } from './ChartFullscreenModal'
import { CHART_BTN } from './chartControls'
import { ChartToolbar } from './ChartToolbar'
import { FilterPills, type Filter } from './FilterPills'
const ForecastChartWidget = lazy(() =>
  import('./ForecastChartWidget').then((m) => ({ default: m.ForecastChartWidget })),
)
import { TypewriterText } from './TypewriterText'

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
  /** Optional filename stem for the CSV export. */
  exportName?: string
  /** When set, enables AI anomaly detection on this result. */
  queryLogId?: string | null
  /** Heading shown in the fullscreen overlay (e.g. the NL question). */
  title?: string
  /** Controlled fullscreen state — when provided, the trigger lives outside
   *  (e.g. an icon on the result card header). Falls back to internal state. */
  fullscreen?: boolean
  onFullscreenChange?: (open: boolean) => void
}

/** Interactive chart with a type switcher, legend toggle, CSV export,
 *  click-to-drill-down filtering and AI anomaly detection. */
export function ChartView({
  data,
  config,
  exportName = 'nexusbi',
  queryLogId,
  title,
  fullscreen,
  onFullscreenChange,
}: Props) {
  const { t } = useTranslation()
  const [type, setType] = useState<ChartType>(config.chart_type)
  const [showLegend, setShowLegend] = useState(false)
  const [filters, setFilters] = useState<Filter[]>([])
  const [anomalies, setAnomalies] = useState<AnomalyResult | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [forecast, setForecast] = useState<ForecastResult | null>(null)
  const [forecasting, setForecasting] = useState(false)
  const [rootCause, setRootCause] = useState<RootCauseResult | null>(null)
  const [rooting, setRooting] = useState(false)
  const [lineage, setLineage] = useState<Lineage | null>(null)
  const [tracing, setTracing] = useState(false)
  const [significance, setSignificance] = useState<SignificanceResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [causal, setCausal] = useState<CausalResult | null>(null)
  const [findingDrivers, setFindingDrivers] = useState(false)
  const [scenario, setScenario] = useState(false)
  const [internalFs, setInternalFs] = useState(false)
  // Controlled if the parent passes fullscreen/onFullscreenChange, else internal.
  const fsOpen = fullscreen ?? internalFs
  const setFs = onFullscreenChange ?? setInternalFs

  // Reset view state when a new result arrives.
  useEffect(() => {
    setType(config.chart_type)
    setFilters([])
    setAnomalies(null)
    setForecast(null)
    setRootCause(null)
    setLineage(null)
    setSignificance(null)
    setCausal(null)
    setScenario(false)
  }, [config.chart_type, data])

  // Numeric metric column for what-if (y_axis if numeric, else first numeric column).
  const valueCol = useMemo(() => {
    const sample = data[0] ?? {}
    if (config.y_axis && typeof sample[config.y_axis] === 'number') return config.y_axis
    return Object.keys(sample).find((k) => typeof sample[k] === 'number') ?? null
  }, [data, config.y_axis])

  // Correlation-driver analysis needs at least two numeric columns; the typical
  // (dimension, one measure) result can only return "no other numeric column",
  // so gate the menu item instead of offering an apology.
  const numericCount = useMemo(() => {
    const sample = data[0] ?? {}
    return Object.keys(sample).filter((k) => typeof sample[k] === 'number').length
  }, [data])

  const runForecast = async () => {
    if (!queryLogId) return
    setForecasting(true)
    try {
      setForecast(await analysisApi.forecast(queryLogId))
    } catch {
      /* interceptor toast */
    } finally {
      setForecasting(false)
    }
  }

  const runAnomalies = async () => {
    if (!queryLogId) return
    setDetecting(true)
    try {
      setAnomalies(await analysisApi.detectAnomalies(queryLogId))
    } catch {
      /* interceptor toast */
    } finally {
      setDetecting(false)
    }
  }

  const runRootCause = async () => {
    if (!queryLogId) return
    setRooting(true)
    try {
      setRootCause(await analysisApi.rootCause(queryLogId))
    } catch {
      /* interceptor toast */
    } finally {
      setRooting(false)
    }
  }

  const runSignificance = async () => {
    if (!queryLogId) return
    setChecking(true)
    try {
      setSignificance(await analysisApi.significance(queryLogId))
    } catch {
      /* interceptor toast */
    } finally {
      setChecking(false)
    }
  }

  const runCausal = async () => {
    if (!queryLogId) return
    setFindingDrivers(true)
    try {
      setCausal(await analysisApi.causal(queryLogId))
    } catch {
      /* interceptor toast */
    } finally {
      setFindingDrivers(false)
    }
  }

  const runLineage = async () => {
    if (!queryLogId) return
    setTracing(true)
    try {
      setLineage(await analysisApi.lineage(queryLogId))
    } catch {
      /* interceptor toast */
    } finally {
      setTracing(false)
    }
  }

  const anomalyLabels = useMemo(
    () => new Set((anomalies?.anomalies ?? []).map((a) => String(a.label))),
    [anomalies],
  )

  const addFilter = (field: string, value: unknown) => {
    if (value === undefined || value === null) return
    const next: Filter = { field, value: String(value) }
    setFilters((cur) =>
      cur.some((f) => f.field === next.field && f.value === next.value) ? cur : [...cur, next],
    )
  }

  const filtered = useMemo(
    () =>
      filters.length
        ? data.filter((row) => filters.every((f) => String(row[f.field]) === f.value))
        : data,
    [data, filters],
  )

  // Badge on the AI-tools trigger: how many analysis panels are currently open.
  const openPanelCount = [
    !!forecast,
    !!anomalies,
    !!rootCause,
    !!lineage,
    !!significance,
    !!causal,
    scenario,
  ].filter(Boolean).length

  // The AI actions behind the "Alətlər" menu trigger.
  const aiSections: ActionMenuSection[] = [
    {
      header: t('chartView.groupForecast'),
      items: [
        {
          key: 'forecast',
          Icon: TrendingUp,
          label: forecasting ? t('chartView.forecasting') : t('chartView.forecast'),
          onSelect: runForecast,
          active: !!forecast,
          disabled: forecasting,
        },
        {
          key: 'scenario',
          Icon: SlidersHorizontal,
          label: t('chartView.scenario'),
          onSelect: () => setScenario((v) => !v),
          active: scenario,
          disabled: !valueCol,
        },
      ],
    },
    {
      header: t('chartView.groupDiagnostics'),
      items: [
        {
          key: 'anomalies',
          Icon: AlertTriangle,
          label: detecting ? t('chartView.detecting') : t('chartView.anomalies'),
          onSelect: runAnomalies,
          active: !!anomalies,
          disabled: detecting,
        },
        {
          key: 'why',
          Icon: GitBranch,
          label: rooting ? t('chartView.rooting') : t('chartView.why'),
          onSelect: runRootCause,
          active: !!rootCause,
          disabled: rooting,
        },
        {
          key: 'causal',
          Icon: Workflow,
          label: findingDrivers
            ? t('chartView.findingDrivers')
            : numericCount < 2
              ? t('chartView.causalNeedsTwo')
              : t('chartView.causal'),
          onSelect: runCausal,
          active: !!causal,
          disabled: findingDrivers || numericCount < 2,
        },
        {
          key: 'significance',
          Icon: ShieldCheck,
          label: checking ? t('chartView.checking') : t('chartView.significance'),
          onSelect: runSignificance,
          active: !!significance,
          disabled: checking,
        },
        {
          key: 'lineage',
          Icon: GitFork,
          label: tracing ? t('chartView.tracing') : t('chartView.lineage'),
          onSelect: runLineage,
          active: !!lineage,
          disabled: tracing,
        },
      ],
    },
  ]

  // Every analysis card gets a top-right dismiss button; closing it also drops
  // the Alətlər badge count and the item's active check (same state). The
  // card (first child) gets extra right padding so its content — wrapped AI
  // summaries, ScenarioPanel's header input — never lands under the X.
  const closable = (onClose: () => void, node: ReactNode) => (
    <div className="relative [&>*:first-child]:pr-10">
      {node}
      <button
        type="button"
        onClick={onClose}
        aria-label={t('chartView.closePanel')}
        title={t('chartView.closePanel')}
        className="absolute right-2 top-2 rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <X size={14} />
      </button>
    </div>
  )

  const activeConfig: ChartConfig = { ...config, chart_type: type }

  // Saved KPI target matching this measure (exact name match, scale-gated)
  // → dashed reference line on bar/line/area. Query page is always authed.
  const targets = useKpiTargets()
  const yKey = config.y_axis ?? Object.keys(data[0] ?? {})[1]
  const matchedTarget = matchTarget(targets, [config.y_axis, title])
  const targetValue = targetValueFor(matchedTarget, data, yKey)

  // Many-point line/area charts get cluttered x-axis labels; wheel/drag zoom
  // thins them out. Pie also benefits: zooming windows the slices so you can
  // inspect the long tail past the Top-N fold. Bars instead scroll (a standard
  // right-side scrollbar reveals every column). Scatter/table/kpi stay as-is.
  // Multi-series (color_by) results are excluded: ChartZoom windows LONG rows
  // by index, which would cut an x-group mid-way and plot false dips.
  const hasColorBy =
    !!activeConfig.color_by &&
    activeConfig.color_by !== activeConfig.x_axis &&
    activeConfig.color_by !== activeConfig.y_axis
  const zoomable = (type === 'line' || type === 'area' || type === 'pie') && !hasColorBy

  const renderChart = (height: number | string) => {
    const chart = (data: Record<string, unknown>[]) => (
      <ChartRenderer
        data={data}
        config={activeConfig}
        height={height}
        showLegend={showLegend}
        onPointClick={addFilter}
        anomalyLabels={anomalyLabels}
        scrollableBars={type === 'bar'}
        targetValue={targetValue}
        target={matchedTarget}
      />
    )
    return (
      <ErrorBoundary variant="widget" label={t('chartView.chart')} resetKeys={[filtered, type]}>
        {zoomable ? <ChartZoom data={filtered}>{chart}</ChartZoom> : chart(filtered)}
      </ErrorBoundary>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ChartToolbar value={type} onChange={setType} />
        {type === 'pie' && (
          <button
            onClick={() => setShowLegend((v) => !v)}
            aria-pressed={showLegend}
            className={`${CHART_BTN} border ${
              showLegend ? 'border-accent text-accent' : 'border-line text-ink-soft hover:text-ink'
            }`}
          >
            <Tags size={14} /> {t('chartView.legend')}
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {queryLogId && (
          <ActionMenu
            ariaLabel={t('chartView.tools')}
            triggerLabel={t('chartView.tools')}
            triggerIcon={Wrench}
            count={openPanelCount}
            sections={aiSections}
          />
        )}
        <button
          onClick={() => downloadCsv(filtered, `${exportName}.csv`)}
          aria-label={t('chartView.downloadCsv')}
          className={`${CHART_BTN} border border-line text-ink-soft hover:border-accent hover:text-ink`}
        >
          <Download size={14} /> CSV
        </button>
      </div>

      <FilterPills
        filters={filters}
        onRemove={(i) => setFilters((cur) => cur.filter((_, idx) => idx !== i))}
        onClear={() => setFilters([])}
      />

      {renderChart(320)}

      <Suspense
        fallback={
          <div className="h-16 animate-pulse rounded-xl border border-line bg-surface-2" />
        }
      >
      {anomalies && closable(() => setAnomalies(null), <AnomalyPanel result={anomalies} />)}

      {rootCause && closable(() => setRootCause(null), <RootCausePanel result={rootCause} />)}

      {lineage && closable(() => setLineage(null), <LineagePanel lineage={lineage} />)}

      {significance &&
        closable(() => setSignificance(null), <StatsGuardPanel result={significance} />)}

      {causal && closable(() => setCausal(null), <CausalPanel result={causal} />)}

      {scenario &&
        closable(
          () => setScenario(false),
          <ScenarioPanel data={filtered} valueCol={valueCol} queryLogId={queryLogId} />,
        )}

      {forecast &&
        closable(
          () => setForecast(null),
          <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={15} className="text-accent" />
              <p className="eyebrow text-ink-soft">{t('chartView.forecast')}</p>
            </div>
            <ForecastChartWidget result={forecast} />
            {forecast.narrative && (
              <TypewriterText
                text={forecast.narrative}
                className="text-sm leading-relaxed text-ink-soft"
              />
            )}
          </div>,
        )}
      </Suspense>

      <ChartFullscreenModal
        open={fsOpen}
        onClose={() => setFs(false)}
        title={title}
      >
        <div className="flex h-full flex-col gap-3">
          <ChartToolbar value={type} onChange={setType} />
          <FilterPills
            filters={filters}
            onRemove={(i) => setFilters((cur) => cur.filter((_, idx) => idx !== i))}
            onClear={() => setFilters([])}
          />
          <div className="min-h-0 flex-1">{renderChart('100%')}</div>
        </div>
      </ChartFullscreenModal>
    </div>
  )
}
