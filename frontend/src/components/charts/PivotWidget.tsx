import { useEffect, useMemo, useRef, useState } from 'react'
import { AGG_LABELS, computePivot, formatPivotValue, type AggFn } from '../../lib/pivot'

interface Props {
  data: Record<string, unknown>[]
}

const AGGS: AggFn[] = ['sum', 'avg', 'count', 'min', 'max']

const SELECT_CLS =
  'rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs text-ink focus:border-accent focus:outline-none'

// A column is numeric if its first NON-NULL value is a number (a null in row 0
// must not misclassify an otherwise-numeric column as categorical).
function classify(columns: string[], data: Record<string, unknown>[]) {
  const numeric = columns.filter((c) => typeof data.find((r) => r[c] != null)?.[c] === 'number')
  const rowField = columns.find((c) => !numeric.includes(c)) ?? columns[0] ?? ''
  const measure = numeric[0] ?? columns[0] ?? ''
  return { numeric, rowField, measure }
}

/** Client-side pivot explorer — Excel-PivotTable-style cross-tab over a result set. */
export function PivotWidget({ data }: Props) {
  const columns = useMemo(() => (data[0] ? Object.keys(data[0]) : []), [data])
  const { rowField: defRow, measure: defMeasure } = useMemo(
    () => classify(columns, data),
    [columns, data],
  )

  const [rowField, setRowField] = useState(defRow)
  const [colField, setColField] = useState<string>('') // '' → no column dimension
  const [measure, setMeasure] = useState(defMeasure)
  const [agg, setAgg] = useState<AggFn>('sum')

  // Re-derive defaults when the columns change (a new query with a different
  // shape) — otherwise stale field names silently pivot to garbage.
  const colSig = columns.join('|')
  const lastSig = useRef(colSig)
  useEffect(() => {
    if (lastSig.current === colSig) return
    lastSig.current = colSig
    setRowField(defRow)
    setColField('')
    setMeasure(defMeasure)
    setAgg('sum')
  }, [colSig, defRow, defMeasure])

  const setRow = (v: string) => {
    setRowField(v)
    if (colField === v) setColField('') // row/col must differ
  }

  const pivot = useMemo(
    () => computePivot(data, { rowField, colField: colField || null, measure, agg }),
    [data, rowField, colField, measure, agg],
  )

  if (!columns.length) return <p className="text-ink-soft">Nəticə yoxdur.</p>

  const valueHeader = `${AGG_LABELS[agg]}(${agg === 'count' ? '*' : measure})`

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Sətir">
          <select className={SELECT_CLS} value={rowField} onChange={(e) => setRow(e.target.value)}>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sütun">
          <select className={SELECT_CLS} value={colField} onChange={(e) => setColField(e.target.value)}>
            <option value="">Yoxdur</option>
            {columns
              .filter((c) => c !== rowField)
              .map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Ölçü">
          <select
            className={SELECT_CLS}
            value={measure}
            onChange={(e) => setMeasure(e.target.value)}
            disabled={agg === 'count'}
          >
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Aqreqat">
          <select className={SELECT_CLS} value={agg} onChange={(e) => setAgg(e.target.value as AggFn)}>
            {AGGS.map((a) => (
              <option key={a} value={a}>
                {AGG_LABELS[a]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* Pivot table */}
      <div className="max-h-96 overflow-auto rounded-xl border border-line">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-surface-2">
            <tr>
              <th className="border-b border-line px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-ink-soft">
                {rowField}
              </th>
              {pivot.hasCol ? (
                <>
                  {pivot.colKeys.map((ck) => (
                    <th
                      key={ck}
                      className="border-b border-line px-4 py-2.5 text-right font-mono text-[11px] uppercase tracking-wider text-ink-soft"
                    >
                      {ck}
                    </th>
                  ))}
                  <th className="border-b border-line px-4 py-2.5 text-right font-mono text-[11px] uppercase tracking-wider text-accent">
                    Cəm
                  </th>
                </>
              ) : (
                <th className="border-b border-line px-4 py-2.5 text-right font-mono text-[11px] uppercase tracking-wider text-ink-soft">
                  {valueHeader}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {pivot.rowKeys.map((rk) => (
              <tr key={rk} className="border-t border-line transition hover:bg-surface-2">
                <td className="px-4 py-2.5 text-ink">{rk}</td>
                {pivot.hasCol ? (
                  <>
                    {pivot.colKeys.map((ck) => (
                      <td key={ck} className="px-4 py-2.5 text-right tabular-nums text-ink">
                        {formatPivotValue(pivot.cells[rk][ck])}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums text-accent">
                      {formatPivotValue(pivot.rowTotals[rk])}
                    </td>
                  </>
                ) : (
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                    {formatPivotValue(pivot.rowTotals[rk])}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 bg-surface-2">
            <tr className="border-t border-line">
              <td className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-accent">Cəm</td>
              {pivot.hasCol ? (
                <>
                  {pivot.colKeys.map((ck) => (
                    <td key={ck} className="px-4 py-2.5 text-right font-medium tabular-nums text-accent">
                      {formatPivotValue(pivot.colTotals[ck])}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-accent">
                    {formatPivotValue(pivot.grandTotal)}
                  </td>
                </>
              ) : (
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-accent">
                  {formatPivotValue(pivot.grandTotal)}
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">{label}</span>
      {children}
    </label>
  )
}
