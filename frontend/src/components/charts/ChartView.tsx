import { AlertTriangle, Download, GitBranch, GitFork, ShieldCheck, SlidersHorizontal, Sparkles, Tags, TrendingUp, Workflow } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AnomalyResult,
  ChartConfig,
  ChartType,
  CausalResult,
  ExplainResult,
  ForecastResult,
  Lineage,
  RootCauseResult,
  SignificanceResult,
} from '../../types'
import { downloadCsv } from '../../lib/csv'
import * as analysisApi from '../../api/analysis'
// AI analysis panels load on demand — none render until the user clicks their
// button, so they stay out of the query/dashboard initial chunk.
const AnomalyPanel = lazy(() => import('./AnomalyPanel').then((m) => ({ default: m.AnomalyPanel })))
const ExplainPanel = lazy(() => import('./ExplainPanel').then((m) => ({ default: m.ExplainPanel })))
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
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { ChartRenderer } from './LazyChartRenderer'
import { ChartZoom } from './ChartZoom'
import { ChartFullscreenModal } from './ChartFullscreenModal'
import { CHART_BTN, ChartToolbar } from './ChartToolbar'
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
  const [explanation, setExplanation] = useState<ExplainResult | null>(null)
  const [explaining, setExplaining] = useState(false)
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
    setExplanation(null)
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

  const runExplain = async () => {
    if (!queryLogId) return
    setExplaining(true)
    try {
      setExplanation(await analysisApi.explain(queryLogId))
    } catch {
      /* interceptor toast */
    } finally {
      setExplaining(false)
    }
  }

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

  const activeConfig: ChartConfig = { ...config, chart_type: type }

  // Many-point line/area charts get cluttered x-axis labels; wheel/drag zoom
  // thins them out. Pie also benefits: zooming windows the slices so you can
  // inspect the long tail past the Top-N fold. Bars instead scroll (a standard
  // right-side scrollbar reveals every column). Scatter/table/kpi stay as-is.
  const zoomable = type === 'line' || type === 'area' || type === 'pie'

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ChartToolbar value={type} onChange={setType} />
        <div className="flex flex-wrap items-center justify-end gap-1">
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
          {queryLogId && (
            <>
              <button
                onClick={runForecast}
                disabled={forecasting}
                className={`${CHART_BTN} border ${
                  forecast ? 'border-accent text-accent' : 'border-line text-ink-soft hover:text-ink'
                }`}
              >
                <TrendingUp size={14} /> {forecasting ? t('chartView.forecasting') : t('chartView.forecast')}
              </button>
              <button
                onClick={runAnomalies}
                disabled={detecting}
                className={`${CHART_BTN} border ${
                  anomalies ? 'border-amber-500/50 text-amber-300' : 'border-line text-ink-soft hover:text-ink'
                }`}
              >
                <AlertTriangle size={14} /> {detecting ? t('chartView.detecting') : t('chartView.anomalies')}
              </button>
              <button
                onClick={runExplain}
                disabled={explaining}
                className={`${CHART_BTN} border ${
                  explanation ? 'border-accent text-accent' : 'border-line text-ink-soft hover:text-ink'
                }`}
              >
                <Sparkles size={14} /> {explaining ? t('chartView.explaining') : t('chartView.explain')}
              </button>
              <button
                onClick={runRootCause}
                disabled={rooting}
                className={`${CHART_BTN} border ${
                  rootCause ? 'border-accent text-accent' : 'border-line text-ink-soft hover:text-ink'
                }`}
              >
                <GitBranch size={14} /> {rooting ? t('chartView.rooting') : t('chartView.why')}
              </button>
              <button
                onClick={runLineage}
                disabled={tracing}
                className={`${CHART_BTN} border ${
                  lineage ? 'border-accent text-accent' : 'border-line text-ink-soft hover:text-ink'
                }`}
              >
                <GitFork size={14} /> {tracing ? t('chartView.tracing') : t('chartView.lineage')}
              </button>
              <button
                onClick={runSignificance}
                disabled={checking}
                className={`${CHART_BTN} border ${
                  significance ? 'border-accent text-accent' : 'border-line text-ink-soft hover:text-ink'
                }`}
              >
                <ShieldCheck size={14} /> {checking ? t('chartView.checking') : t('chartView.significance')}
              </button>
              <button
                onClick={runCausal}
                disabled={findingDrivers}
                className={`${CHART_BTN} border ${
                  causal ? 'border-accent text-accent' : 'border-line text-ink-soft hover:text-ink'
                }`}
              >
                <Workflow size={14} /> {findingDrivers ? t('chartView.findingDrivers') : t('chartView.causal')}
              </button>
            </>
          )}
          {valueCol && (
            <button
              onClick={() => setScenario((v) => !v)}
              aria-pressed={scenario}
              className={`${CHART_BTN} border ${
                scenario ? 'border-accent text-accent' : 'border-line text-ink-soft hover:text-ink'
              }`}
            >
              <SlidersHorizontal size={14} /> {t('chartView.scenario')}
            </button>
          )}
          <button
            onClick={() => downloadCsv(filtered, `${exportName}.csv`)}
            aria-label={t('chartView.downloadCsv')}
            className={`${CHART_BTN} border border-line text-ink-soft hover:border-accent hover:text-ink`}
          >
            <Download size={14} /> CSV
          </button>
        </div>
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
      {anomalies && <AnomalyPanel result={anomalies} />}

      {explanation && <ExplainPanel result={explanation} />}

      {rootCause && <RootCausePanel result={rootCause} />}

      {lineage && <LineagePanel lineage={lineage} />}

      {significance && <StatsGuardPanel result={significance} />}

      {causal && <CausalPanel result={causal} />}

      {scenario && <ScenarioPanel data={filtered} valueCol={valueCol} queryLogId={queryLogId} />}

      {forecast && (
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
        </div>
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
