import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CausalPanel } from './CausalPanel'

describe('CausalPanel', () => {
  it('renders target, drivers and caveats', () => {
    render(
      <CausalPanel
        result={{
          target: 'gəlir',
          summary: 'Ən güclü əlaqə: reklam.',
          drivers: [
            { feature: 'reklam', r: 0.82, p_value: 0.001, significant: true, direction: 'müsbət', strength: 'güclü' },
            { feature: 'temp', r: 0.2, p_value: 0.4, significant: false, direction: 'müsbət', strength: 'zəif' },
          ],
          caveats: ['Korrelyasiya səbəbiyyət demək deyil.'],
        }}
      />,
    )
    expect(screen.getByText(/Səbəb analizi/)).toBeInTheDocument()
    expect(screen.getByText('reklam')).toBeInTheDocument()
    expect(screen.getByText(/əhəmiyyətsiz/)).toBeInTheDocument() // non-significant marker
    expect(screen.getByText(/səbəbiyyət/)).toBeInTheDocument()
  })
})
