// Pure client-side pivot: group rows by a row dimension (and optional column
// dimension), aggregate a measure. No backend — operates on the same result rows
// already handed to ChartView. Unit-tested in pivot.test.ts.

export type AggFn = 'sum' | 'avg' | 'count' | 'min' | 'max'

export const AGG_LABELS: Record<AggFn, string> = {
  sum: 'Cəm',
  avg: 'Orta',
  count: 'Say',
  min: 'Min',
  max: 'Maks',
}

export interface PivotConfig {
  rowField: string
  colField: string | null // null → a single value column
  measure: string
  agg: AggFn
}

export interface PivotResult {
  rowKeys: string[]
  colKeys: string[] // [''] when there is no column dimension
  hasCol: boolean
  cells: Record<string, Record<string, number | null>>
  rowTotals: Record<string, number | null>
  colTotals: Record<string, number | null>
  grandTotal: number | null
}

interface Bucket {
  nums: number[] // numeric measure values (for sum/avg/min/max)
  n: number // row count (for count)
}

const NO_COL = ''

function apply(bucket: Bucket | undefined, agg: AggFn): number | null {
  if (!bucket) return null
  if (agg === 'count') return bucket.n
  if (!bucket.nums.length) return null
  const { nums } = bucket
  switch (agg) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0)
    case 'avg':
      return nums.reduce((a, b) => a + b, 0) / nums.length
    case 'min':
      return Math.min(...nums)
    case 'max':
      return Math.max(...nums)
    default:
      return null
  }
}

// Numeric-aware key sort: "2" before "10", otherwise locale string order.
function sortKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const na = Number(a)
    const nb = Number(b)
    if (a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
    return a.localeCompare(b)
  })
}

export function computePivot(data: Record<string, unknown>[], cfg: PivotConfig): PivotResult {
  const { rowField, colField, measure, agg } = cfg
  const groups: Record<string, Record<string, Bucket>> = {}
  const rowAcc: Record<string, Bucket> = {}
  const colAcc: Record<string, Bucket> = {}
  const grand: Bucket = { nums: [], n: 0 }
  const rowSet = new Set<string>()
  const colSet = new Set<string>()

  const add = (b: Bucket, num: number | null) => {
    b.n += 1
    if (num !== null) b.nums.push(num)
  }

  for (const row of data) {
    const rk = String(row[rowField] ?? '—')
    const ck = colField ? String(row[colField] ?? '—') : NO_COL
    rowSet.add(rk)
    if (colField) colSet.add(ck)
    const raw = row[measure]
    const num = typeof raw === 'number' && !Number.isNaN(raw) ? raw : null

    ;(groups[rk] ??= {})[ck] ??= { nums: [], n: 0 }
    add(groups[rk][ck], num)
    add((rowAcc[rk] ??= { nums: [], n: 0 }), num)
    add((colAcc[ck] ??= { nums: [], n: 0 }), num)
    add(grand, num)
  }

  const rowKeys = sortKeys([...rowSet])
  const colKeys = colField ? sortKeys([...colSet]) : [NO_COL]

  const cells: Record<string, Record<string, number | null>> = {}
  for (const rk of rowKeys) {
    cells[rk] = {}
    for (const ck of colKeys) cells[rk][ck] = apply(groups[rk]?.[ck], agg)
  }

  return {
    rowKeys,
    colKeys,
    hasCol: !!colField,
    cells,
    rowTotals: Object.fromEntries(rowKeys.map((rk) => [rk, apply(rowAcc[rk], agg)])),
    colTotals: Object.fromEntries(colKeys.map((ck) => [ck, apply(colAcc[ck], agg)])),
    grandTotal: apply(grand, agg),
  }
}

/** Compact number formatting for pivot cells (— for empty). */
export function formatPivotValue(v: number | null): string {
  if (v === null) return '—'
  return Number.isInteger(v)
    ? v.toLocaleString()
    : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
