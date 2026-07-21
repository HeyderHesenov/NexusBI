/** Long→wide pivot for multi-series charts (config.color_by).
 *  (Distinct from lib/pivot.ts computePivot — that builds the cross-tab TABLE
 *  widget; this shapes rows for multi-line/area charts.) */

export interface SeriesPivot {
  /** One row per x value (first-seen order); one numeric key per series. */
  rows: Record<string, unknown>[]
  /** Series names in FIRST-SEEN order (fold bucket last). Hues assign in this
   *  order so a series keeps its color when totals reorder between refreshes —
   *  color follows the entity, never its rank. */
  series: string[]
}

/**
 * Pivot long rows (x, y, colorBy) into wide rows keyed by colorBy value.
 * The SMALLEST-total series beyond `maxSeries` fold into one summed
 * `otherLabel` column so chart hues are never cycled. Duplicate (x, series)
 * cells are summed; missing cells stay undefined so lines show honest gaps.
 */
export function pivotSeries(
  data: Record<string, unknown>[],
  x: string,
  y: string,
  colorBy: string,
  maxSeries: number,
  otherLabel: string,
): SeriesPivot {
  const totals = new Map<string, number>() // Map preserves first-seen order
  for (const row of data) {
    const name = String(row[colorBy] ?? '')
    totals.set(name, (totals.get(name) ?? 0) + (Number(row[y]) || 0))
  }
  const firstSeen = [...totals.keys()]
  const folds = firstSeen.length > maxSeries
  const byTotalDesc = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  const kept = new Set(folds ? byTotalDesc.slice(0, maxSeries - 1) : firstSeen)

  // Two key collisions can clobber real cells: a series named exactly like the
  // x column (label cell) or exactly like the fold bucket. Suffix an NBSP —
  // invisible in legends, distinct as an object key.
  const safeKey = (name: string) => (name === x ? `${name}\u00A0` : name)
  const foldKey = kept.has(otherLabel) ? `${otherLabel}\u00A0` : otherLabel

  const rowByX = new Map<string, Record<string, unknown>>()
  for (const row of data) {
    const xv = row[x]
    const rowKey = String(xv ?? '')
    let out = rowByX.get(rowKey)
    if (!out) {
      out = { [x]: xv }
      rowByX.set(rowKey, out)
    }
    const name = String(row[colorBy] ?? '')
    const key = kept.has(name) ? safeKey(name) : foldKey
    out[key] = ((out[key] as number) ?? 0) + (Number(row[y]) || 0)
  }

  const series = firstSeen.filter((n) => kept.has(n)).map(safeKey)
  if (folds) series.push(foldKey)
  return { rows: [...rowByX.values()], series }
}

/**
 * Collapse a single-series long table into one honest point per x by SUMMING y
 * over duplicate x values (same sum-semantics as pivotSeries). Turns
 * un-aggregated rows — e.g. 25 individual sales on the same date — into a clean
 * trend instead of a vertical zig-zag stack. First-seen x order is preserved.
 * When every x is already unique the input is returned UNCHANGED, so aggregated
 * results keep any extra columns their tooltips rely on.
 */
export function collapseByX(
  data: Record<string, unknown>[],
  x: string,
  y: string,
): Record<string, unknown>[] {
  const sums = new Map<string, number>() // Map preserves first-seen order
  const labels = new Map<string, unknown>()
  for (const row of data) {
    const key = String(row[x] ?? '')
    sums.set(key, (sums.get(key) ?? 0) + (Number(row[y]) || 0))
    if (!labels.has(key)) labels.set(key, row[x])
  }
  if (sums.size === data.length) return data // already one row per x — untouched
  return [...sums.entries()].map(([key, sum]) => ({ [x]: labels.get(key), [y]: sum }))
}

// YYYY / YYYY-MM / YYYY-MM-DD (with an optional time suffix) — ISO forms whose
// lexicographic order IS chronological order.
const _DATEISH = /^\d{4}(-\d{2}(-\d{2}([T ][\d:.]+Z?)?)?)?$/

/**
 * Sort rows ascending by the x field ONLY when x is a chronological or numeric
 * axis: ISO date-ish strings sort lexicographically (= chronological), all-numeric
 * x sorts numerically. Arbitrary category x (e.g. funnel stages, region names) is
 * left in the query's own order. Never mutates the input array.
 */
export function sortByX(
  rows: Record<string, unknown>[],
  x: string,
): Record<string, unknown>[] {
  if (rows.length < 2) return rows
  const vals = rows.map((r) => r[x])
  const allNumeric = vals.every((v) => v !== null && v !== '' && Number.isFinite(Number(v)))
  const allDateish = vals.every((v) => _DATEISH.test(String(v)))
  if (!allNumeric && !allDateish) return rows
  const sorted = [...rows]
  sorted.sort(
    allNumeric && !allDateish
      ? (a, b) => Number(a[x]) - Number(b[x])
      : (a, b) => String(a[x]).localeCompare(String(b[x])),
  )
  return sorted
}
