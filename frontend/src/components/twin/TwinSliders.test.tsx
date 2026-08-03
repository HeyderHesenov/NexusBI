import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { leaf, measuredLeaf } from '../../test/metricTreeFixtures'
import { TwinSliders } from './TwinSliders'

// Test i18n is initialized with Azerbaijani (see src/test/setup.ts).
describe('TwinSliders', () => {
  it('shows a measured leaf its own measured base, not 0', () => {
    // The readout used to be `manual_value ?? 0`, which is null for a leaf
    // measured from a query: the lever printed "0 → 0" while the KPI above it
    // moved by the full amount.
    const leaves = [measuredLeaf('s', 3200, 'Satış')]
    render(<TwinSliders leaves={leaves} adjustments={{ s: 10 }} onChange={vi.fn()} onClear={vi.fn()} />)

    const row = screen.getByText('Satış').closest('.rounded-xl') as HTMLElement
    // az-formatted: "." is the thousands separator.
    expect(row.textContent).toContain('3.200')
    expect(row.textContent).toContain('3.520') // 3200 × 1.1
  })

  it('labels each lever with where its number came from', () => {
    const leaves = [measuredLeaf('s', 100, 'Satış'), leaf('t', 5, 'Təxmin')]
    const { container } = render(
      <TwinSliders leaves={leaves} adjustments={{}} onChange={vi.fn()} onClear={vi.fn()} />,
    )
    expect(container.querySelector('[data-provenance="measured"]')).not.toBeNull()
    expect(container.querySelector('[data-provenance="manual"]')).not.toBeNull()
  })
})
