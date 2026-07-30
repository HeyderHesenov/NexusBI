import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ShareMeta } from '../../api/chat'
import type { ChartType } from '../../types'
import { ShareChartModal } from './ShareChartModal'

// Stub the renderer: jsdom gives ResponsiveContainer a 0×0 box, so no recharts
// widget renders anything measurable here — and keeping the real one out is the
// whole point of this component's laziness.
vi.mock('../charts/LazyChartRenderer', () => ({
  ChartRenderer: (p: { config: { chart_type: string }; showLegend?: boolean }) => (
    <div data-testid="chart" data-type={p.config.chart_type} data-legend={String(p.showLegend)} />
  ),
}))

vi.mock('../../lib/csv', () => ({ downloadCsv: vi.fn() }))
import { downloadCsv } from '../../lib/csv'

const rows = [
  { city: 'Bakı', revenue: 120 },
  { city: 'Gəncə', revenue: 60 },
]

const meta = (over: Partial<ShareMeta> = {}): ShareMeta =>
  ({
    kind: 'share',
    resource_type: 'query_log',
    resource_id: 'q1',
    caption: '',
    title: 'Rayonlar üzrə gəlir',
    ...over,
  }) as ShareMeta

const chart = (chart_type: ChartType = 'bar', over: Record<string, unknown> = {}) => ({
  chart_type,
  chart_config: { chart_type, x_axis: 'city', y_axis: 'revenue', color_by: null },
  columns: ['city', 'revenue'],
  data: rows,
  ...over,
})

const open = (c = chart(), m = meta()) =>
  render(<ShareChartModal meta={m} chart={c as never} onClose={() => {}} />)

describe('ShareChartModal', () => {
  it('renders the chart at its native type, full size, with the legend ON', () => {
    open()
    const el = screen.getByTestId('chart')
    expect(el).toHaveAttribute('data-type', 'bar')
    // The card hardcoded showLegend={false}; the modal has room for it.
    expect(el).toHaveAttribute('data-legend', 'true')
  })

  it('titles the dialog with the card title', () => {
    open()
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Rayonlar üzrə gəlir')
  })

  it('toggles to the rows and back, tracking state in aria-pressed', async () => {
    open()
    const table = screen.getByRole('button', { name: /Cədvəl/ })
    const graph = screen.getByRole('button', { name: /Qrafik/ })
    expect(graph).toHaveAttribute('aria-pressed', 'true')
    expect(table).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(table)
    expect(screen.getByTestId('chart')).toHaveAttribute('data-type', 'table')
    expect(table).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(graph)
    expect(screen.getByTestId('chart')).toHaveAttribute('data-type', 'bar')
  })

  it.each(['table', 'pivot'] as const)('hides the toggle for %s — it IS the rows', (type) => {
    open(chart(type))
    expect(screen.queryByRole('button', { name: /Cədvəl/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Qrafik/ })).toBeNull()
    expect(screen.getByTestId('chart')).toHaveAttribute('data-type', type)
  })

  /** Open the download menu and pick a format row. */
  const pickFormat = async (name: RegExp) => {
    await userEvent.click(screen.getByRole('button', { name: /Yüklə/ }))
    await userEvent.click(screen.getByRole('menuitem', { name }))
  }

  it('downloads the snapshot rows as CSV under a title-derived name', async () => {
    open()
    await pickFormat(/CSV/)
    expect(downloadCsv).toHaveBeenCalledWith(rows, 'nexusbi-rayonlar-üzrə-gəlir.csv')
  })

  it('falls back to a generic CSV name when the title has no usable characters', async () => {
    open(chart(), meta({ title: '!!!' }))
    await pickFormat(/CSV/)
    expect(downloadCsv).toHaveBeenCalledWith(rows, 'nexusbi-export.csv')
  })

  it('offers the image formats for a chart', async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: /Yüklə/ }))
    expect(screen.getByRole('menuitem', { name: /PNG/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /SVG/ })).toBeInTheDocument()
  })

  it.each(['table', 'pivot'] as const)(
    'omits the image formats for %s — DOM rows have no <svg> to serialize',
    async (type) => {
      open(chart(type))
      await userEvent.click(screen.getByRole('button', { name: /Yüklə/ }))
      expect(screen.getByRole('menuitem', { name: /CSV/ })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: /PNG/ })).toBeNull()
      expect(screen.queryByRole('menuitem', { name: /SVG/ })).toBeNull()
    },
  )

  it('drops the image formats once the user flips the chart to its rows', async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: /Cədvəl/ }))
    await userEvent.click(screen.getByRole('button', { name: /Yüklə/ }))
    expect(screen.queryByRole('menuitem', { name: /PNG/ })).toBeNull()
  })

  it('shows the insight when the snapshot carries one', () => {
    open(chart('bar', { insight: 'Bakı gəlirin 66%-ni verir' }))
    expect(screen.getByText(/Bakı gəlirin 66%-ni verir/)).toBeInTheDocument()
  })

  it('omits the insight row when there is none', () => {
    open()
    expect(screen.queryByText(/İnsight/)).toBeNull()
  })

  it('warns when the shared snapshot dropped rows', () => {
    open(chart('bar', { truncated: true }))
    expect(screen.getByText('İlk 2 sətir göstərilir')).toBeInTheDocument()
  })

  it('stays quiet when nothing was dropped', () => {
    open()
    expect(screen.queryByText(/göstərilir/)).toBeNull()
  })
})
