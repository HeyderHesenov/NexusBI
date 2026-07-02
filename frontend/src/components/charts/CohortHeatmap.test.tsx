import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CohortHeatmap } from './CohortHeatmap'
import type { CohortData } from '../../types'

const DATA: CohortData = {
  cohorts: ['2024-01', '2024-02'],
  offsets: [0, 1],
  sizes: [5, 5],
  cells: [
    [{ count: 5, pct: 100 }, { count: 4, pct: 80 }],
    [{ count: 5, pct: 100 }, null],
  ],
}

describe('CohortHeatmap', () => {
  it('renders one row per cohort with pct cells', () => {
    render(<CohortHeatmap data={DATA} />)
    expect(screen.getByText('2024-01')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getAllByText('100%')).toHaveLength(2)
  })

  it('renders out-of-range cells as placeholders, not 0%', () => {
    render(<CohortHeatmap data={DATA} />)
    expect(screen.getByText('·')).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('shows an empty state without cohorts', () => {
    render(<CohortHeatmap data={{ cohorts: [], offsets: [], sizes: [], cells: [] }} />)
    expect(screen.queryByTestId('cohort-heatmap')).not.toBeInTheDocument()
  })
})
