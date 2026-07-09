import type { KPITarget } from '../api/scenario'

/**
 * Case-insensitive EXACT name match between saved KPI targets and a chart's
 * candidate names (y-axis column, widget title). Substring matching is
 * deliberately avoided — a wrong target line is worse than none.
 */
export function matchTarget(
  targets: KPITarget[],
  candidates: Array<string | null | undefined>,
): KPITarget | null {
  const wanted = new Set(
    candidates.filter((c): c is string => !!c && !!c.trim()).map((c) => c.trim().toLowerCase()),
  )
  if (!wanted.size) return null
  return targets.find((t) => wanted.has(t.name.trim().toLowerCase())) ?? null
}

/** How far past the data a target line may stretch the axis before we assume
 *  the match was wrong (e.g. a widget TITLE matched a target for a different
 *  measure) and suppress it — a 1.2M line over a 50–80 series flattens the
 *  chart into a floor stripe. */
const TARGET_SCALE_CAP = 3

/** Target value for a chart, or undefined when it is out of scale with the
 *  plotted series (name matching is fuzzy by nature; scale is the sanity check). */
export function targetValueFor(
  target: KPITarget | null,
  rows: Record<string, unknown>[],
  yKey: string | null | undefined,
): number | undefined {
  if (!target || !Number.isFinite(target.target_value) || !yKey) return undefined
  let maxAbs = 0
  for (const row of rows) {
    const v = Math.abs(Number(row[yKey]))
    if (Number.isFinite(v) && v > maxAbs) maxAbs = v
  }
  if (maxAbs === 0) return undefined
  return Math.abs(target.target_value) <= maxAbs * TARGET_SCALE_CAP
    ? target.target_value
    : undefined
}
