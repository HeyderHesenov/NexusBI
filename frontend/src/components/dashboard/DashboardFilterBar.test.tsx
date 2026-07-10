import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Dashboard, DashboardFilterSpec } from '../../types'
import { DashboardFilterBar } from './DashboardFilterBar'
import { mergeFilteredWidgets } from '../../store/dashboardStore'

const widget = (id: string, rows: Record<string, unknown>[]): Dashboard['widgets'][number] => ({
  id,
  title: id,
  query_log_id: null,
  position_x: 0,
  position_y: 0,
  width: 6,
  height: 9,
  chart: {
    natural_language: '',
    sql: '',
    insight: '',
    chart_type: 'bar',
    chart_config: { chart_type: 'bar', x_axis: 'region', y_axis: 'total', color_by: null },
    columns: Object.keys(rows[0] ?? {}),
    data: rows,
  },
})

const dash: Dashboard = {
  id: 'd1',
  name: 'D',
  description: '',
  layout: null,
  widgets: [
    widget('w1', [
      { region: 'North', product: 'A', total: 1 },
      { region: 'South', product: 'B', total: 2 },
    ]),
  ],
}

describe('DashboardFilterBar (multi-slicer)', () => {
  it('emits every slicer with selected values as one dimensions array', () => {
    const onApply = vi.fn()
    render(<DashboardFilterBar dashboard={dash} active={null} busy={false} onApply={onApply} />)

    // Slicer 1: region → North
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[1], { target: { value: 'region' } }) // [0] is the date column
    fireEvent.click(screen.getByRole('button', { name: 'North' }))

    // Add slicer 2: product → B
    fireEvent.click(screen.getByRole('button', { name: /Slicer əlavə et|Add slicer/ }))
    const selects2 = screen.getAllByRole('combobox')
    fireEvent.change(selects2[2], { target: { value: 'product' } })
    fireEvent.click(screen.getByRole('button', { name: 'B' }))

    fireEvent.click(screen.getByRole('button', { name: /Tətbiq|Apply/ }))
    const spec: DashboardFilterSpec = onApply.mock.calls[0][0]
    expect(spec.dimensions).toEqual([
      { column: 'region', values: ['North'] },
      { column: 'product', values: ['B'] },
    ])
  })

  it('slicers without a selection are excluded from the spec', () => {
    const onApply = vi.fn()
    render(<DashboardFilterBar dashboard={dash} active={null} busy={false} onApply={onApply} />)
    fireEvent.click(screen.getByRole('button', { name: /Tətbiq|Apply/ }))
    expect(onApply.mock.calls[0][0].dimensions).toEqual([])
  })

  it('initializes slicers from the active persisted filter', () => {
    const active: DashboardFilterSpec = {
      date_column: null,
      date_start: null,
      date_end: null,
      dimensions: [{ column: 'region', values: ['North'] }],
    }
    render(<DashboardFilterBar dashboard={dash} active={active} busy={false} onApply={() => {}} />)
    expect(screen.getByRole('button', { name: 'North' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('mergeFilteredWidgets', () => {
  const widgets = [
    { id: 'a', chart: { x: 1 } as never },
    { id: 'b', chart: { x: 2 } as never },
  ]

  it('swaps present charts, nulls explicit nulls, keeps absent widgets', () => {
    const merged = mergeFilteredWidgets(widgets, [
      { widget_id: 'a', chart: { x: 9 } as never },
      { widget_id: 'b', chart: null },
    ])
    expect(merged[0].chart).toEqual({ x: 9 })
    expect(merged[1].chart).toBeNull()
    const partial = mergeFilteredWidgets(widgets, [{ widget_id: 'a', chart: null }])
    expect(partial[1].chart).toEqual({ x: 2 })
  })
})
