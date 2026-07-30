import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChartType, Dashboard, Widget } from '../../types'
import { DashboardPrintView } from './DashboardPrintView'

// Stand in for recharts: emit a fake surface for the SVG chart types and plain
// DOM for the rest, which is exactly the distinction the readiness check keys on.
vi.mock('../charts/LazyChartRenderer', () => ({
  ChartRenderer: ({ config, height }: { config: { chart_type: ChartType }; height: number }) =>
    ['bar', 'line', 'area', 'pie', 'scatter'].includes(config.chart_type) ? (
      <svg className="recharts-surface" data-testid="surface" data-height={height} />
    ) : (
      <div data-testid="dom-widget" data-height={height} />
    ),
}))

const widget = (id: string, title: string, chart_type: ChartType = 'bar'): Widget =>
  ({
    id,
    title,
    query_log_id: 'q',
    position_x: 0,
    position_y: 0,
    width: 6,
    height: 9,
    chart: {
      chart_type,
      chart_config: { chart_type, x_axis: 'city', y_axis: 'revenue', color_by: null },
      columns: ['city', 'revenue'],
      data: [{ city: 'Bakı', revenue: 120 }],
    },
  }) as unknown as Widget

const board = (widgets: Widget[]): Dashboard => ({
  id: 'd1',
  name: 'Satış paneli',
  description: '',
  layout: null,
  widgets,
})

describe('DashboardPrintView', () => {
  it('renders the board name and one block per widget', () => {
    render(
      <DashboardPrintView
        dashboard={board([widget('w1', 'Aylıq gəlir'), widget('w2', 'Region üzrə', 'pie')])}
        onReady={() => {}}
      />,
    )
    // Queried by text, not by role: the sheet is aria-hidden (it duplicates the
    // live board), so nothing inside it is exposed to the accessibility tree.
    expect(screen.getByText('Satış paneli')).toBeInTheDocument()
    expect(screen.getByText('Aylıq gəlir')).toBeInTheDocument()
    expect(screen.getByText('Region üzrə')).toBeInTheDocument()
    expect(screen.getAllByTestId('surface')).toHaveLength(2)
  })

  it('portals the sheet to <body> and keeps it out of the a11y tree', () => {
    render(<DashboardPrintView dashboard={board([widget('w1', 'A')])} onReady={() => {}} />)
    const sheet = screen.getByTestId('print-sheet')
    expect(sheet.parentElement).toBe(document.body)
    expect(sheet).toHaveAttribute('aria-hidden', 'true')
  })

  it('lays the sheet out off-screen rather than display:none, so charts can measure', () => {
    render(<DashboardPrintView dashboard={board([widget('w1', 'A')])} onReady={() => {}} />)
    const sheet = screen.getByTestId('print-sheet')
    expect(sheet.className).toContain('fixed')
    expect(sheet.className).toContain('left-[-300vw]')
    expect(sheet.className).not.toContain('hidden')
  })

  it('gives a KPI card less paper than a chart', () => {
    render(
      <DashboardPrintView
        dashboard={board([widget('w1', 'Gəlir', 'kpi_card'), widget('w2', 'Trend', 'line')])}
        onReady={() => {}}
      />,
    )
    expect(screen.getByTestId('dom-widget')).toHaveAttribute('data-height', '180')
    expect(screen.getByTestId('surface')).toHaveAttribute('data-height', '400')
  })

  it('signals ready once every chart surface has painted', async () => {
    const onReady = vi.fn()
    render(
      <DashboardPrintView
        dashboard={board([widget('w1', 'A'), widget('w2', 'B', 'scatter')])}
        onReady={onReady}
      />,
    )
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
  })

  it('signals ready without waiting when no widget renders an SVG', async () => {
    const onReady = vi.fn()
    render(
      <DashboardPrintView
        dashboard={board([widget('w1', 'Rows', 'table'), widget('w2', 'KPI', 'kpi_card')])}
        onReady={onReady}
      />,
    )
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('surface')).toBeNull()
  })

  it('shows an empty note for a widget that has no rows', async () => {
    const empty = { ...widget('w1', 'Boş'), chart: null } as Widget
    render(<DashboardPrintView dashboard={board([empty])} onReady={() => {}} />)
    expect(screen.getByText('Bu sorğunun nəticəsi yoxdur.')).toBeInTheDocument()
  })
})
