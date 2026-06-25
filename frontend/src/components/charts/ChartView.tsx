import { AlertTriangle, Download, Tags, TrendingUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AnomalyResult, ChartConfig, ChartType, ForecastResult } from '../../types'
import { downloadCsv } from '../../lib/csv'
import * as analysisApi from '../../api/analysis'
import { AnomalyPanel } from './AnomalyPanel'
import { ChartRenderer } from './ChartRenderer'
import { CHART_BTN, ChartToolbar } from './ChartToolbar'
import { FilterPills, type Filter } from './FilterPills'
import { ForecastChartWidget } from './ForecastChartWidget'

interface Props {
  data: Record<string, unknown>[]
  config: ChartConfig
  /** Optional filename stem for the CSV export. */
  exportName?: string
  /** When set, enables AI anomaly detection on this result. */
  queryLogId?: string | null
}

/** Interactive chart with a type switcher, legend toggle, CSV export,
 *  click-to-drill-down filtering and AI anomaly detection. */
export function ChartView({ data, config, exportName = 'nexusbi', queryLogId }: Props) {
  const [type, setType] = useState<ChartType>(config.chart_type)
  const [showLegend, setShowLegend] = useState(false)
  const [filters, setFilters] = useState<Filter[]>([])
  const [anomalies, setAnomalies] = useState<AnomalyResult | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [forecast, setForecast] = useState<ForecastResult | null>(null)
  const [forecasting, setForecasting] = useState(false)

  // Reset view state when a new result arrives.
  useEffect(() => {
    setType(config.chart_type)
    setFilters([])
    setAnomalies(null)
    setForecast(null)
  }, [config.chart_type, data])

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ChartToolbar value={type} onChange={setType} />
        <div className="flex items-center gap-1">
          {type === 'pie' && (
            <button
              onClick={() => setShowLegend((v) => !v)}
              aria-pressed={showLegend}
              className={`${CHART_BTN} border ${
                showLegend ? 'border-accent text-accent' : 'border-line text-ink-soft hover:text-ink'
              }`}
            >
              <Tags size={14} /> Açıqlama
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
                <TrendingUp size={14} /> {forecasting ? 'Proqnoz…' : 'Proqnoz'}
              </button>
              <button
                onClick={runAnomalies}
                disabled={detecting}
                className={`${CHART_BTN} border ${
                  anomalies ? 'border-amber-500/50 text-amber-300' : 'border-line text-ink-soft hover:text-ink'
                }`}
              >
                <AlertTriangle size={14} /> {detecting ? 'Təhlil…' : 'Anomaliyalar'}
              </button>
            </>
          )}
          <button
            onClick={() => downloadCsv(filtered, `${exportName}.csv`)}
            aria-label="CSV yüklə"
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

      <ChartRenderer
        data={filtered}
        config={activeConfig}
        showLegend={showLegend}
        onPointClick={addFilter}
        anomalyLabels={anomalyLabels}
      />

      {anomalies && <AnomalyPanel result={anomalies} />}

      {forecast && (
        <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-4">
          <div className="flex items-center gap-2">
            <TrendingUp size={15} className="text-accent" />
            <p className="eyebrow text-ink-soft">Proqnoz</p>
          </div>
          <ForecastChartWidget result={forecast} />
          {forecast.narrative && (
            <p className="text-sm leading-relaxed text-ink-soft">{forecast.narrative}</p>
          )}
        </div>
      )}
    </div>
  )
}
