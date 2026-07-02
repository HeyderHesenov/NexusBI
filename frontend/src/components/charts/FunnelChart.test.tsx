import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FunnelChart } from './FunnelChart'
import type { FunnelStep } from '../../types'

const STEPS: FunnelStep[] = [
  { name: 'visit', count: 60, pct_of_first: 100, drop_pct: 0 },
  { name: 'signup', count: 45, pct_of_first: 75, drop_pct: 25 },
  { name: 'purchase', count: 20, pct_of_first: 33.3, drop_pct: 55.6 },
]

describe('FunnelChart', () => {
  it('renders a band per step with counts and share of first', () => {
    render(<FunnelChart steps={STEPS} />)
    const svg = screen.getByTestId('funnel-chart')
    expect(svg.querySelectorAll('rect')).toHaveLength(3)
    expect(screen.getByText('60 · 100%')).toBeInTheDocument()
    expect(screen.getByText('20 · 33.3%')).toBeInTheDocument()
  })

  it('labels the drop-off between consecutive steps', () => {
    render(<FunnelChart steps={STEPS} />)
    expect(screen.getByText('−25%')).toBeInTheDocument()
    expect(screen.getByText('−55.6%')).toBeInTheDocument()
  })

  it('renders an empty state without steps', () => {
    render(<FunnelChart steps={[]} />)
    expect(screen.queryByTestId('funnel-chart')).not.toBeInTheDocument()
  })
})
