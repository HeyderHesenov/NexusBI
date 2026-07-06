import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatFactChips } from './StatFactChips'
import type { StatFact } from '../../types'

// Test i18n is initialized with Azerbaijani (see src/test/setup.ts), so t() returns real AZ strings.
describe('StatFactChips', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<StatFactChips facts={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the top category name as its own descriptor (data, not localized)', () => {
    const facts: StatFact[] = [{ kind: 'top', label: 'Laptop', value: '300 (60%)' }]
    render(<StatFactChips facts={facts} />)
    expect(screen.getByText('Laptop')).toBeInTheDocument()
    expect(screen.getByText('300 (60%)')).toBeInTheDocument()
  })

  it('localizes total/trend/anomaly descriptors from kind', () => {
    const facts: StatFact[] = [
      { kind: 'total', label: '', value: '500' },
      { kind: 'trend', label: '', value: '+12%' },
      { kind: 'anomaly', label: '', value: '2' },
    ]
    render(<StatFactChips facts={facts} />)
    expect(screen.getByText('Cəmi')).toBeInTheDocument()
    expect(screen.getByText('Dövr Δ')).toBeInTheDocument()
    expect(screen.getByText('Anomaliya')).toBeInTheDocument()
    expect(screen.getByText('+12%')).toBeInTheDocument()
  })
})
