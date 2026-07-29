import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SWOTGrid } from './SWOTGrid'
import type { BAContent } from '../../types'

describe('SWOTGrid', () => {
  it('renders a legacy artifact whose buckets hold bare strings', () => {
    // Artifacts saved before the evidence layer have no `facts` and no item
    // objects. They must render fully — just without any chips.
    const legacy: BAContent = {
      strengths: ['Güclü komanda'],
      weaknesses: ['Zəif kanal'],
      opportunities: [],
      threats: [],
    }
    render(<SWOTGrid content={legacy} />)
    expect(screen.getByText('Güclü komanda')).toBeTruthy()
    expect(screen.getByText('Zəif kanal')).toBeTruthy()
    // No facts to contrast against, so no per-bullet labelling at all.
    expect(screen.queryByText('mülahizə')).toBeNull()
    expect(screen.queryByText('hesablanmış')).toBeNull()
  })

  it('separates computed bullets from judgements when facts are present', () => {
    const content: BAContent = {
      facts: [{ id: 'f1', kind: 'trend', label: '', value: '-12%', source: 'sales.revenue' }],
      strengths: [{ text: 'Marka tanınır', evidence: [], derived: false }],
      weaknesses: [{ text: 'Trend mənfidir', evidence: ['f1'], derived: true }],
      opportunities: [],
      threats: [],
    }
    render(<SWOTGrid content={content} />)
    expect(screen.getByText('hesablanmış')).toBeTruthy()
    expect(screen.getByText('-12%')).toBeTruthy()
    expect(screen.getByText('mülahizə')).toBeTruthy()
  })

  it('shows the per-quadrant empty message', () => {
    render(<SWOTGrid content={{ strengths: [], weaknesses: [], opportunities: [], threats: [] }} />)
    expect(screen.getAllByText('Bənd tapılmadı').length).toBe(4)
  })
})
