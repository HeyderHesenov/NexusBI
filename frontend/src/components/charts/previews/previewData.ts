import type { ChartConfig } from '../../../types'

export type Row = Record<string, unknown>

const num = (v: unknown) => Number(v) || 0

/** The (label, value) column pair a preview reads. Mirrors the widgets' own
 *  fallback — configured axes first, else the first two columns
 *  (BarChartWidget.tsx:64-65, PieChartWidget.tsx:30-31). */
export function pickAxes(data: Row[], config: ChartConfig): { name: string; value: string } {
  const keys = Object.keys(data[0] ?? {})
  return { name: config.x_axis ?? keys[0] ?? '', value: config.y_axis ?? keys[1] ?? '' }
}

export interface Slice {
  label: string
  value: number
  /** The synthetic folded tail — never takes a series color (PieChartWidget.tsx:95). */
  isOther?: boolean
}

const toSlice = (row: Row, name: string, value: string): Slice => ({
  label: String(row[name] ?? ''),
  value: num(row[value]),
})

/** Value-sorted slices, biggest first. */
export function sortSlices(data: Row[], config: ChartConfig): Slice[] {
  const { name, value } = pickAxes(data, config)
  return data.map((r) => toSlice(r, name, value)).sort((a, b) => b.value - a.value)
}

/** Top-n slices with the tail SUMMED into one "other" slice, so percentages still
 *  total 100%. Mirrors PieChartWidget.tsx:36-43, including its "only fold when the
 *  tail is 2+ rows" rule — a single extra row shouldn't become "Digər (1)". */
export function foldOther(
  data: Row[],
  config: ChartConfig,
  n: number,
  otherLabel: (count: number) => string,
): Slice[] {
  const sorted = sortSlices(data, config)
  if (sorted.length <= n + 1) return sorted
  const rest = sorted.slice(n)
  return [
    ...sorted.slice(0, n),
    {
      label: otherLabel(rest.length),
      value: rest.reduce((sum, s) => sum + s.value, 0),
      isOther: true,
    },
  ]
}

/** Top-n slices plus how many rows were dropped. Unlike foldOther this does NOT
 *  sum the tail: a bar list is a ranking, so "+11 daha" is honest where a summed
 *  synthetic row would invent a category the data doesn't have. */
export function topN(
  data: Row[],
  config: ChartConfig,
  n: number,
): { rows: Slice[]; rest: number; max: number } {
  const sorted = sortSlices(data, config)
  const rows = sorted.slice(0, n)
  return {
    rows,
    rest: Math.max(0, sorted.length - rows.length),
    // Bars scale against the largest visible value; guard /0 on all-zero data.
    max: Math.max(...rows.map((r) => Math.abs(r.value)), 0) || 1,
  }
}

/** Total magnitude of the value column. Bars and donuts need a positive total to
 *  have anything to scale against; ChartPreview uses this to decide viability. */
export function valueTotal(data: Row[], config: ChartConfig): number {
  const { value } = pickAxes(data, config)
  return data.reduce((sum, r) => sum + Math.abs(num(r[value])), 0)
}

/** The numeric series a trend preview draws, in row order (a trend follows the
 *  data, not a ranking). Deliberately NOT deriveKpiSeries: that gates on
 *  looksTemporal (lib/kpi.ts:92) and returns an empty series for a categorical x,
 *  which would leave a line/area preview blank. */
export function pickSeries(data: Row[], config: ChartConfig): number[] {
  const keys = Object.keys(data[0] ?? {})
  const numeric = keys.filter((k) => typeof data[0]?.[k] === 'number')
  const key =
    (config.y_axis && numeric.includes(config.y_axis) && config.y_axis) || numeric[0] || keys[1]
  if (!key) return []
  return data.map((r) => num(r[key]))
}

/** Two numeric axes for a dot cloud; mirrors ScatterChartWidget.tsx:28-35. */
export function pickScatterAxes(data: Row[], config: ChartConfig): { x: string; y: string } {
  const keys = Object.keys(data[0] ?? {})
  const numeric = keys.filter((k) => typeof data[0]?.[k] === 'number')
  const x =
    (config.x_axis && numeric.includes(config.x_axis) && config.x_axis) || numeric[0] || keys[0]
  const y =
    (config.y_axis && numeric.includes(config.y_axis) && config.y_axis) ||
    numeric.find((k) => k !== x) ||
    numeric[0] ||
    keys[1]
  return { x, y }
}
