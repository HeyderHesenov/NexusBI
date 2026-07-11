import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TrustBadge } from './TrustBadge'

// Test i18n is initialized with Azerbaijani (see src/test/setup.ts), so t() returns real AZ strings.
describe('TrustBadge', () => {
  it('renders nothing for a legacy row (no provenance)', () => {
    const { container } = render(<TrustBadge provenance={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('buckets llm confidence into high/medium/low', () => {
    const { rerender } = render(<TrustBadge provenance="llm" confidence={0.9} />)
    expect(screen.getByText('Yüksək etibar')).toBeInTheDocument()

    rerender(<TrustBadge provenance="llm" confidence={0.5} />)
    expect(screen.getByText('Orta etibar')).toBeInTheDocument()

    rerender(<TrustBadge provenance="llm" confidence={0.2} />)
    expect(screen.getByText('Aşağı etibar')).toBeInTheDocument()
  })

  it('labels the offline fallback as deterministic, not scary "low"', () => {
    render(<TrustBadge provenance="deterministic_fallback" />)
    expect(screen.getByText('Deterministik')).toBeInTheDocument()
  })

  it('flags a self-repaired answer', () => {
    render(<TrustBadge provenance="self_repaired" />)
    expect(screen.getByText('Təmir edilmiş')).toBeInTheDocument()
  })

  it('labels analyst SQL as exact', () => {
    render(<TrustBadge provenance="user_sql" confidence={null} />)
    expect(screen.getByText('Dəqiq')).toBeInTheDocument()
  })
})
