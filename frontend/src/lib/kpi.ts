import type { ChartConfig } from '../types'

/** Mirror of the backend's insight_facts._TEMPORAL: YYYY-MM / YYYY/MM prefixes. */
export const TEMPORAL = /^\d{4}[-/]\d{2}/

/** Rows scanned to classify a column as numeric — mirror of insight_facts._SAMPLE_N. */
const SAMPLE_N = 20

export interface KpiSeries {
  /** The value column this series was derived from — the card must use the
   *  SAME key for its label/target matching (two heuristics would disagree). */
  yKey: string | null
  /** Newest value (last point of a temporal series, or the single row). */
  latest: number | null
  /** Second-newest value — null when there is no honest previous period. */
  previous: number | null
  /** Percent change latest vs previous; null when previous is 0 or absent. */
  deltaPct: number | null
  /** Full series in ascending time order (for the sparkline). */
  points: number[]
}

/** Strict numeric coercion: null/''/booleans are NOT zero (Number(null)===0).
 *  Strings drop thousands-separator commas first ("1,234" → 1234), mirroring the
 *  backend's stats.to_float so a comma-grouped cell isn't silently dropped. */
export const num = (v: unknown): number | null => {
  if (v == null || v === '' || typeof v === 'boolean') return null
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v)
  return Number.isFinite(n) ? n : null
}

/** True when ≥80% of the (non-empty) sampled cells coerce to a number — mirror of
 *  the backend's _numeric_columns. Samples several rows (not just data[0], which
 *  may be NULL/atypical) so the measure column isn't misclassified. */
const isNumericColumn = (rows: Record<string, unknown>[], key: string): boolean => {
  let seen = 0
  let coerced = 0
  for (const r of rows.slice(0, SAMPLE_N)) {
    const v = r[key]
    if (v == null || v === '') continue
    seen += 1
    if (num(v) != null) coerced += 1
  }
  return seen > 0 && coerced >= seen * 0.8
}

export const looksTemporal = (labels: string[]): boolean => {
  if (labels.length < 2) return false
  const hits = labels.filter((s) => TEMPORAL.test(s)).length
  return hits >= Math.max(2, Math.floor(labels.length / 2))
}

/** '/' and '-' both pass TEMPORAL; normalize so a mixed series still sorts
 *  chronologically ('2024/03' must not sort after '2024-11'). */
const periodKey = (v: unknown): string => String(v ?? '').replace(/\//g, '-')

/**
 * Derive KPI delta/sparkline inputs from a chart result — client-side, no
 * extra query. Only a multi-row series whose x column LOOKS temporal gets a
 * delta (sorted ascending so "latest" is honest regardless of SQL order);
 * anything else renders the plain value with no fabricated comparison.
 */
export function deriveKpiSeries(
  data: Record<string, unknown>[],
  config: ChartConfig,
): KpiSeries {
  const none: KpiSeries = { yKey: null, latest: null, previous: null, deltaPct: null, points: [] }
  if (!data.length) return none

  const first = data[0]
  const keys = Object.keys(first)
  // Single answer row keeps the first column even when textual (an NL answer
  // like a product name); a multi-row series needs a numeric column that is
  // not the time axis (year/month labels coerce to numbers too). Column type is
  // decided over a sample of rows, not just data[0] (a null first cell would
  // otherwise fall through to keys[0] — the x axis or a text column).
  const yKey =
    config.y_axis ??
    (data.length === 1
      ? keys[0]
      : keys.find((k) => k !== config.x_axis && isNumericColumn(data, k)) ?? keys[0])
  none.yKey = yKey
  const latestOnly = (row: Record<string, unknown>): KpiSeries => ({
    ...none,
    latest: num(row[yKey]),
  })
  if (data.length === 1) return latestOnly(first)

  const xKey = config.x_axis ?? keys.find((k) => k !== yKey)
  if (!xKey) return latestOnly(first)
  const labels = data.map((r) => String(r[xKey] ?? ''))
  if (!looksTemporal(labels)) return latestOnly(first)

  // Keep only genuinely dated rows: rollup rows ("Cəmi", "N/A") sort after
  // every YYYY-MM label and would masquerade as the latest period.
  const points = data
    .filter((r) => TEMPORAL.test(String(r[xKey] ?? '')))
    .sort((a, b) => periodKey(a[xKey]).localeCompare(periodKey(b[xKey])))
    .map((r) => num(r[yKey]))
    .filter((v): v is number => v != null)
  if (points.length < 2) return { ...none, latest: points[0] ?? null, points }

  const latest = points[points.length - 1]
  const previous = points[points.length - 2]
  const deltaPct = previous !== 0 ? ((latest - previous) / Math.abs(previous)) * 100 : null
  return { yKey, latest, previous, deltaPct, points }
}
