import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { KPITarget } from '../../api/scenario'
import type { ChartConfig } from '../../types'
import { KPICard } from './KPICard'

const cfg = (over: Partial<ChartConfig> = {}): ChartConfig => ({
  chart_type: 'kpi_card',
  x_axis: 'month',
  y_axis: 'revenue',
  color_by: null,
  y_label: 'Revenue',
  ...over,
})

const target = (value: number, expected = value / 2): KPITarget => ({
  id: 't1',
  name: 'revenue',
  target_value: value,
  current_value: 0,
  period: 'month',
  period_start: null,
  created_at: '2026-01-01',
  pacing: { attainment_pct: 0, elapsed_pct: 50, expected_value: expected, on_track: true, status: 'on_track' },
})

const temporal = [
  { month: '2024-01', revenue: 100 },
  { month: '2024-02', revenue: 120 },
]

describe('KPICard', () => {
  it('multi-row temporal series shows delta chip and sparkline', () => {
    const { container } = render(<KPICard data={temporal} config={cfg()} />)
    expect(screen.getByText('+20%')).toBeTruthy()
    expect(container.querySelector('svg path')).toBeTruthy()
  })

  it('single row shows the value only — no delta, no sparkline', () => {
    const { container } = render(<KPICard data={[{ revenue: 42 }]} config={cfg({ x_axis: null })} />)
    expect(screen.queryByText(/%/)).toBeNull()
    // only the decorative accent dot, no sparkline path
    expect(container.querySelector('svg path')).toBeNull()
  })

  it('uses the humanized y_label as the card title', () => {
    render(<KPICard data={[{ revenue: 42 }]} config={cfg({ x_axis: null })} />)
    expect(screen.getByText('Revenue')).toBeTruthy()
  })

  it('shows a pacing row for an in-scale target', () => {
    render(<KPICard data={temporal} config={cfg()} target={target(150, 110)} />)
    // latest 120 vs target 150 → 80%; 120 >= expected 110 → on track
    expect(screen.getByText('· 80%')).toBeTruthy()
  })

  it('suppresses pacing when the target is wildly out of scale', () => {
    render(<KPICard data={temporal} config={cfg()} target={target(1_200_000)} />)
    // the delta chip may render, but no pacing "· NN%" row appears
    expect(screen.queryByText(/^· \d+%$/)).toBeNull()
  })
})
