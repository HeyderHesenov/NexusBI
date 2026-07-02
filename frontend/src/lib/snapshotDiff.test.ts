import { describe, expect, it } from 'vitest'
import { diffSnapshot, numericTotal } from './snapshotDiff'
import type { SnapshotWidget, Widget } from '../types'

const snapWidget = (id: string, rows: Record<string, unknown>[]): SnapshotWidget => ({
  widget_id: id,
  title: `W ${id}`,
  chart_type: 'bar',
  chart_config: { chart_type: 'bar', x_axis: 'region', y_axis: 'total', color_by: null },
  columns: rows[0] ? Object.keys(rows[0]) : [],
  rows,
})

const curWidget = (id: string, rows: Record<string, unknown>[]): Widget => ({
  id,
  title: `W ${id}`,
  query_log_id: 'q',
  position_x: 0,
  position_y: 0,
  width: 4,
  height: 4,
  chart: {
    chart_type: 'bar',
    chart_config: { chart_type: 'bar', x_axis: 'region', y_axis: 'total', color_by: null },
    columns: rows[0] ? Object.keys(rows[0]) : [],
    data: rows,
    insight: '',
    sql: '',
    natural_language: '',
  },
})

describe('numericTotal', () => {
  it('sums the first numeric column', () => {
    expect(numericTotal([{ region: 'N', total: 10 }, { region: 'S', total: 32 }])).toBe(42)
  })
  it('skips leading null values when classifying', () => {
    expect(numericTotal([{ total: null }, { total: 5 }])).toBe(5)
  })
  it('returns null with no numeric column or no rows', () => {
    expect(numericTotal([{ a: 'x' }])).toBeNull()
    expect(numericTotal([])).toBeNull()
  })
})

describe('diffSnapshot', () => {
  it('computes the delta for a changed widget', () => {
    const out = diffSnapshot(
      [snapWidget('w1', [{ total: 100 }])],
      [curWidget('w1', [{ total: 150 }])],
    )
    expect(out).toHaveLength(1)
    expect(out[0].status).toBe('changed')
    expect(out[0].deltaPct).toBe(50)
  })

  it('flags identical widgets as same', () => {
    const out = diffSnapshot(
      [snapWidget('w1', [{ total: 100 }])],
      [curWidget('w1', [{ total: 100 }])],
    )
    expect(out[0].status).toBe('same')
  })

  it('marks snapshot widgets deleted since as missing_now (no crash on lookup miss)', () => {
    const out = diffSnapshot([snapWidget('gone', [{ total: 5 }])], [])
    expect(out[0].status).toBe('missing_now')
    expect(out[0].after).toBeNull()
  })

  it('marks current widgets absent from the snapshot as new_since', () => {
    const out = diffSnapshot([], [curWidget('w9', [{ total: 7 }])])
    expect(out[0].status).toBe('new_since')
    expect(out[0].after).toBe(7)
  })

  it('leaves deltaPct null when the baseline is zero', () => {
    const out = diffSnapshot(
      [snapWidget('w1', [{ total: 0 }])],
      [curWidget('w1', [{ total: 10 }])],
    )
    expect(out[0].deltaPct).toBeNull()
    expect(out[0].status).toBe('changed')
  })
})
