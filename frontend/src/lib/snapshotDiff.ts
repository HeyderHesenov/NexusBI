import type { SnapshotWidget, Widget } from '../types'

export interface WidgetDelta {
  widgetId: string
  title: string
  /** changed/same = present then and now; missing_now = deleted since; new_since = added since. */
  status: 'changed' | 'same' | 'missing_now' | 'new_since'
  before: number | null
  after: number | null
  deltaPct: number | null
}

/** Sum of the first numeric column — the widget's headline magnitude. */
export function numericTotal(rows: Record<string, unknown>[]): number | null {
  if (!rows.length) return null
  const first = rows.find((r) => Object.values(r).some((v) => typeof v === 'number'))
  if (!first) return null
  const col = Object.keys(first).find((k) => typeof first[k] === 'number')
  if (!col) return null
  return rows.reduce((sum, r) => sum + (typeof r[col] === 'number' ? (r[col] as number) : 0), 0)
}

/** Compare a snapshot's widgets against the dashboard's current widgets. */
export function diffSnapshot(snapWidgets: SnapshotWidget[], current: Widget[]): WidgetDelta[] {
  const currentById = new Map(current.map((w) => [w.id, w]))
  const snapIds = new Set(snapWidgets.map((w) => w.widget_id))
  const out: WidgetDelta[] = []

  for (const sw of snapWidgets) {
    const cur = currentById.get(sw.widget_id)
    const before = numericTotal(sw.rows)
    if (!cur) {
      out.push({ widgetId: sw.widget_id, title: sw.title, status: 'missing_now', before, after: null, deltaPct: null })
      continue
    }
    const after = numericTotal(cur.chart?.data ?? [])
    let deltaPct: number | null = null
    if (before !== null && after !== null && before !== 0) {
      deltaPct = Math.round(((after - before) / Math.abs(before)) * 1000) / 10
    }
    const changed = before !== after
    out.push({
      widgetId: sw.widget_id,
      title: sw.title,
      status: changed ? 'changed' : 'same',
      before,
      after,
      deltaPct,
    })
  }

  for (const w of current) {
    if (!snapIds.has(w.id)) {
      out.push({
        widgetId: w.id,
        title: w.title,
        status: 'new_since',
        before: null,
        after: numericTotal(w.chart?.data ?? []),
        deltaPct: null,
      })
    }
  }
  return out
}
