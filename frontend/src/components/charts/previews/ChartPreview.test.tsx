import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ChartConfig, ChartType } from '../../../types'
import { ChartPreview } from './ChartPreview'
import { SERIES } from '../theme'

const cfg = (chart_type: ChartType, over: Partial<ChartConfig> = {}): ChartConfig => ({
  chart_type,
  x_axis: 'city',
  y_axis: 'revenue',
  color_by: null,
  ...over,
})

const cities = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ city: `Şəhər${i}`, revenue: (n - i) * 100 }))

describe('ChartPreview — bar', () => {
  it('ranks the top rows with labels and values', () => {
    render(<ChartPreview data={cities(3)} config={cfg('bar')} />)
    expect(screen.getByText('Şəhər0')).toBeInTheDocument()
    expect(screen.getByText('Şəhər2')).toBeInTheDocument()
  })

  it('folds the tail into a "+K daha" note rather than inventing a total', () => {
    render(<ChartPreview data={cities(15)} config={cfg('bar')} />)
    // 15 rows, 4 shown → 11 dropped
    expect(screen.getByText('+11 daha')).toBeInTheDocument()
    expect(screen.queryByText(/Digər/)).toBeNull()
  })

  it('omits the note when everything fits', () => {
    render(<ChartPreview data={cities(3)} config={cfg('bar')} />)
    expect(screen.queryByText(/daha/)).toBeNull()
  })

  it('every bar shares one emerald — length and label carry the meaning', () => {
    const { container } = render(<ChartPreview data={cities(3)} config={cfg('bar')} />)
    const bars = container.querySelectorAll('.bg-accent')
    expect(bars).toHaveLength(3)
  })
})

describe('ChartPreview — pie', () => {
  it('draws one arc per slice', () => {
    const { container } = render(<ChartPreview data={cities(3)} config={cfg('pie')} />)
    expect(container.querySelectorAll('svg circle')).toHaveLength(3)
  })

  it('colors the first slice from the shared SERIES palette', () => {
    const { container } = render(<ChartPreview data={cities(3)} config={cfg('pie')} />)
    expect(container.querySelector('svg circle')?.getAttribute('stroke')).toBe(SERIES[0])
  })

  it('folds the tail and never gives it a series color', () => {
    const { container } = render(<ChartPreview data={cities(9)} config={cfg('pie')} />)
    // 9 rows, TOP_N=4 → 4 arcs + one folded
    const arcs = container.querySelectorAll('svg circle')
    expect(arcs).toHaveLength(5)
    // Mirrors PieChartWidget.tsx:95.
    expect(arcs[4].getAttribute('stroke')).toBe('rgb(var(--ink-faint))')
    expect(screen.getByText('Digər (5)')).toBeInTheDocument()
  })

  it('dash segments sum to the circumference', () => {
    const { container } = render(<ChartPreview data={cities(4)} config={cfg('pie')} />)
    const circ = 2 * Math.PI * 42
    const drawn = Array.from(container.querySelectorAll('svg circle')).reduce(
      (sum, c) => sum + Number(c.getAttribute('stroke-dasharray')!.split(' ')[0]),
      0,
    )
    expect(drawn).toBeCloseTo(circ, 5)
  })

  it('shows percentages that read as data, not decoration', () => {
    // 100 + 300 → 25% / 75%
    render(
      <ChartPreview
        data={[
          { city: 'A', revenue: 300 },
          { city: 'B', revenue: 100 },
        ]}
        config={cfg('pie')}
      />,
    )
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
  })
})

describe('ChartPreview — line / area', () => {
  it.each(['line', 'area'] as const)('draws a sparkline for %s', (type) => {
    const { container } = render(<ChartPreview data={cities(4)} config={cfg(type)} />)
    expect(container.querySelector('svg path')).toBeTruthy()
  })

  it('renders fluid (viewBox), not a fixed pixel box that would clip', () => {
    const { container } = render(<ChartPreview data={cities(4)} config={cfg('line')} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBeTruthy()
    expect(svg.getAttribute('width')).toBeNull()
  })

  it('still draws when the x axis is CATEGORICAL, not temporal', () => {
    // The deriveKpiSeries regression guard: that helper gates on looksTemporal
    // (lib/kpi.ts:92) and would leave this preview blank.
    const data = [
      { city: 'Bakı', revenue: 120 },
      { city: 'Gəncə', revenue: 60 },
      { city: 'Sumqayıt', revenue: 45 },
    ]
    const { container } = render(<ChartPreview data={data} config={cfg('line')} />)
    expect(container.querySelector('svg path')).toBeTruthy()
  })
})

describe('ChartPreview — scatter', () => {
  it('draws one dot per row', () => {
    const data = [
      { w: 1, h: 2 },
      { w: 3, h: 4 },
      { w: 5, h: 1 },
    ]
    const { container } = render(
      <ChartPreview data={data} config={cfg('scatter', { x_axis: 'w', y_axis: 'h' })} />,
    )
    expect(container.querySelectorAll('.rounded-full')).toHaveLength(3)
  })

  it('caps the cloud so a big snapshot cannot flood the card', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({ w: i, h: i * 2 }))
    const { container } = render(
      <ChartPreview data={data} config={cfg('scatter', { x_axis: 'w', y_axis: 'h' })} />,
    )
    expect(container.querySelectorAll('.rounded-full')).toHaveLength(40)
  })

  it('survives a flat axis without dividing by zero', () => {
    const data = [
      { w: 5, h: 1 },
      { w: 5, h: 2 },
    ]
    const { container } = render(
      <ChartPreview data={data} config={cfg('scatter', { x_axis: 'w', y_axis: 'h' })} />,
    )
    const left = container.querySelector<HTMLElement>('.rounded-full')!.style.left
    expect(left).toBe('50%')
  })
})

describe('ChartPreview — table / pivot', () => {
  it.each(['table', 'pivot'] as const)('states the size for %s', (type) => {
    render(<ChartPreview data={cities(12)} config={cfg(type)} />)
    expect(screen.getByText('12 sətir × 2 sütun')).toBeInTheDocument()
  })

  it('shows the first cells', () => {
    render(<ChartPreview data={cities(12)} config={cfg('table')} />)
    expect(screen.getByText('Şəhər0')).toBeInTheDocument()
    // ROWS = 3
    expect(screen.queryByText('Şəhər3')).toBeNull()
  })

  it('prefers the snapshot column order over the first row keys', () => {
    render(<ChartPreview data={cities(2)} config={cfg('table')} columns={['city', 'revenue']} />)
    expect(screen.getByText('2 sətir × 2 sütun')).toBeInTheDocument()
  })
})

describe('ChartPreview — kpi_card', () => {
  it('compresses to value + delta + sparkline', () => {
    const data = [
      { month: '2024-01', revenue: 100 },
      { month: '2024-02', revenue: 120 },
    ]
    const { container } = render(
      <ChartPreview data={data} config={cfg('kpi_card', { x_axis: 'month' })} />,
    )
    expect(screen.getByText('+20%')).toBeInTheDocument()
    expect(container.querySelector('svg path')).toBeTruthy()
  })

  it('shows a dash rather than nothing when there is no value', () => {
    render(<ChartPreview data={[{ city: 'A' }]} config={cfg('kpi_card')} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('ChartPreview — degenerate input never leaves an empty box', () => {
  // ShareCard wraps the preview in a button; a blank button is a trap.
  it('renders nothing at all for zero rows', () => {
    const { container } = render(<ChartPreview data={[]} config={cfg('bar')} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('falls back to the table summary for a single-row line', () => {
    const { container } = render(<ChartPreview data={cities(1)} config={cfg('line')} />)
    expect(screen.getByText('1 sətir × 2 sütun')).toBeInTheDocument()
    expect(container.querySelector('svg path')).toBeNull()
  })

  it('falls back to the table summary for a single-row scatter', () => {
    render(<ChartPreview data={[{ w: 1, h: 2 }]} config={cfg('scatter', { x_axis: 'w', y_axis: 'h' })} />)
    expect(screen.getByText('1 sətir × 2 sütun')).toBeInTheDocument()
  })

  it.each(['bar', 'pie'] as const)('falls back to the table summary for all-zero %s', (type) => {
    const data = [
      { city: 'A', revenue: 0 },
      { city: 'B', revenue: 0 },
    ]
    render(<ChartPreview data={data} config={cfg(type)} />)
    expect(screen.getByText('2 sətir × 2 sütun')).toBeInTheDocument()
  })

  it('falls back to the table summary when the value column is missing', () => {
    render(<ChartPreview data={[{ city: 'A' }, { city: 'B' }]} config={cfg('bar')} />)
    expect(screen.getByText('2 sətir × 1 sütun')).toBeInTheDocument()
  })

  it('falls back to the table summary for a chart type newer than this build', () => {
    // Forward-compat, mirroring ShareCard's `TYPE_ICONS[…] ?? Share2`.
    render(<ChartPreview data={cities(2)} config={cfg('sunburst' as ChartType)} />)
    expect(screen.getByText('2 sətir × 2 sütun')).toBeInTheDocument()
  })
})
