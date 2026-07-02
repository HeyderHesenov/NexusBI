import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BCGMatrix } from './BCGMatrix'
import type { BAContent } from '../../types'

const content: BAContent = {
  items: [
    { label: 'Books', share_pct: 28.9, growth_pct: 7.3, quadrant: 'star' },
    { label: 'Clothing', share_pct: 15.7, growth_pct: -4.8, quadrant: 'dog' },
  ],
  thresholds: { share_pct: 19.7, growth_pct: 0 },
}

describe('BCGMatrix', () => {
  it('renders a bubble + legend row per item', () => {
    render(<BCGMatrix content={content} />)
    const svg = screen.getByTestId('bcg-matrix').querySelector('svg')!
    expect(svg.querySelectorAll('g > circle').length).toBe(4) // halo + core per item
    expect(screen.getAllByText('Books').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Clothing').length).toBeGreaterThan(0)
  })

  it('renders nothing without items', () => {
    const { container } = render(<BCGMatrix content={{ items: [] }} />)
    expect(container.firstChild).toBeNull()
  })
})
