import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatsGuardPanel } from './StatsGuardPanel'

describe('StatsGuardPanel', () => {
  it('renders the summary and one row per check', () => {
    render(
      <StatsGuardPanel
        result={{
          summary: '1/2 yoxlama keçdi.',
          checks: [
            { name: 'Nümunə həcmi', passed: true, severity: 'ok', detail: '50 müşahidə.' },
            { name: 'Saxta korrelyasiya', passed: false, severity: 'warn', detail: '1 şübhəli.' },
          ],
        }}
      />,
    )
    expect(screen.getByText(/1\/2 yoxlama keçdi/)).toBeInTheDocument()
    expect(screen.getByText('Nümunə həcmi')).toBeInTheDocument()
    expect(screen.getByText('Saxta korrelyasiya')).toBeInTheDocument()
    expect(screen.getByText(/1 şübhəli/)).toBeInTheDocument()
  })
})
