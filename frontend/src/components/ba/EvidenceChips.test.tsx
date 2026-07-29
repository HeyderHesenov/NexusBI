import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EvidenceChips, ItemEvidence } from './EvidenceChips'
import type { BAFact } from '../../types'

const facts: BAFact[] = [
  { id: 'f1', kind: 'total', label: '', value: '59.7K', source: 'sales.revenue / sale_date' },
  { id: 'f2', kind: 'trend', label: '', value: '-12%', source: 'sales.revenue / sale_date' },
  { id: 'f3', kind: 'top', label: 'Books', value: '5.5K (9%)', source: 'sales.revenue / product' },
]

describe('EvidenceChips', () => {
  it('renders a chip per fact with its value', () => {
    render(<EvidenceChips facts={facts} />)
    expect(screen.getByTestId('ba-evidence-chips')).toBeTruthy()
    expect(screen.getByText('59.7K')).toBeTruthy()
    expect(screen.getByText('-12%')).toBeTruthy()
    expect(screen.getByText('5.5K (9%)')).toBeTruthy()
  })

  it('shows the data label when there is one, else the localized kind', () => {
    render(<EvidenceChips facts={facts} />)
    expect(screen.getByText('Books')).toBeTruthy() // top carries a data label
    expect(screen.getByText('cəmi')).toBeTruthy() // total has none
  })

  it('carries the source string so a chip is traceable', () => {
    render(<EvidenceChips facts={facts} />)
    expect(screen.getByText('59.7K').closest('span[title]')?.getAttribute('title')).toBe(
      'sales.revenue / sale_date',
    )
  })

  it('renders nothing without facts', () => {
    const { container } = render(<EvidenceChips facts={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('ItemEvidence', () => {
  it('shows the computed marker and the cited values on a derived item', () => {
    render(<ItemEvidence cited={[facts[1]]} derived hasFacts />)
    expect(screen.getByText('hesablanmış')).toBeTruthy()
    expect(screen.getByText('-12%')).toBeTruthy()
  })

  it('labels a model-authored item a judgement', () => {
    render(<ItemEvidence cited={[]} derived={false} hasFacts />)
    expect(screen.getByText('mülahizə')).toBeTruthy()
  })

  it('never shows the computed marker without resolved facts', () => {
    // A derived flag with no resolvable evidence must not claim grounding.
    render(<ItemEvidence cited={[]} derived hasFacts />)
    expect(screen.queryByText('hesablanmış')).toBeNull()
    expect(screen.getByText('mülahizə')).toBeTruthy()
  })

  it('stays silent when the artifact has no facts at all', () => {
    // Legacy artifact: with nothing to contrast against, the label is noise.
    const { container } = render(<ItemEvidence cited={[]} derived={false} hasFacts={false} />)
    expect(container.firstChild).toBeNull()
  })
})
