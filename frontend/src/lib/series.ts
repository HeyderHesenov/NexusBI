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
