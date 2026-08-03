import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { leaf, node, unknownLeaf } from '../../test/metricTreeFixtures'
import { IncompleteNotice } from './IncompleteNotice'

// Test i18n is initialized with Azerbaijani (see src/test/setup.ts).
describe('IncompleteNotice', () => {
  const broken = node(
    'root',
    'mul',
    [
      leaf('p', 20, 'Qiymət'),
      unknownLeaf('v', 'Həcm'),
      unknownLeaf('s', 'Satış', 'query_missing'),
    ],
    null,
  )

  it('names every empty leaf and why it is empty', () => {
    render(<IncompleteNotice root={broken} onGoToTree={vi.fn()} />)
    // "Incomplete" on its own sends the user hunting through the tree; the
    // names and reasons are what make this actionable.
    expect(screen.getByText('Həcm')).toBeInTheDocument()
    expect(screen.getByText('dəyər yazılmayıb')).toBeInTheDocument()
    expect(screen.getByText('Satış')).toBeInTheDocument()
    expect(screen.getByText('bağlı sorğu silinib')).toBeInTheDocument()
    // A leaf that HAS a value is not listed — the list is a to-do, not a census.
    expect(screen.queryByText('Qiymət')).toBeNull()
  })

  it('routes to the tree so the fix is one click away', () => {
    const onGoToTree = vi.fn()
    render(<IncompleteNotice root={broken} onGoToTree={onGoToTree} />)
    fireEvent.click(screen.getByRole('button', { name: /Ağacda doldur/ }))
    expect(onGoToTree).toHaveBeenCalledTimes(1)
  })
})
