import { act, render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BindableSource, EvaluatedNode, MetricNodeCreate, MetricNodeUpdate } from '../../types'
import { leaf, measuredLeaf, node, unknownLeaf } from '../../test/metricTreeFixtures'

const load = vi.fn(() => Promise.resolve())
const loadSources = vi.fn(() => Promise.resolve())
// Typed parameters, not bare `vi.fn()`: an untyped mock records calls as `[]`,
// so `add.mock.calls[0][0]` would not even compile — and a payload assertion is
// the whole point of the binding test.
const add = vi.fn((_payload: MetricNodeCreate) => Promise.resolve())
const edit = vi.fn((_id: string, _payload: MetricNodeUpdate) => Promise.resolve())
const remove = vi.fn((_id: string) => Promise.resolve())

let treeState: {
  forest: EvaluatedNode[]
  sources: BindableSource[]
  load: typeof load
  loadSources: typeof loadSources
  add: typeof add
  edit: typeof edit
  remove: typeof remove
}

vi.mock('../../store/metricTreeStore', () => ({
  useMetricTreeStore: Object.assign(() => treeState, { getState: () => treeState }),
}))

import { MetricTreeEditor } from './MetricTreeEditor'

const source: BindableSource = {
  saved_query_id: 'sq-1',
  name: 'Aylıq satış',
  columns: ['product_name', 'total'],
  last_run_at: '2026-08-04T09:00:00Z',
}

// Test i18n is initialized with Azerbaijani (see src/test/setup.ts).
beforeEach(() => {
  vi.clearAllMocks()
  treeState = { forest: [], sources: [], load, loadSources, add, edit, remove }
})

describe('leaf provenance on the tree row', () => {
  it('shows an em dash for an unknown leaf — never a zero', () => {
    treeState.forest = [node('root', 'mul', [leaf('p', 20, 'Qiymət'), unknownLeaf('v', 'Həcm')], null)]
    render(<MetricTreeEditor />)

    // The whole point: 20 × <unknown> has no value, and the old code printed 0.
    const row = screen.getByText('Həcm').closest('div') as HTMLElement
    expect(row.textContent).toContain('—')
    expect(row.textContent).not.toMatch(/\b0\b/)
    // Asserted on the data attribute, not on an <svg> lookup: every chip and the
    // select chevron are svgs, so a querySelector('svg') check passes even when
    // the chip is deleted.
    expect(row.querySelector('[data-provenance="unknown"]')).not.toBeNull()
  })

  it('labels measured and manual leaves differently', () => {
    treeState.forest = [
      node('root', 'add', [measuredLeaf('s', 300, 'Satış'), leaf('t', 5, 'Təxmin')], 305),
    ]
    const { container } = render(<MetricTreeEditor />)
    expect(container.querySelector('[data-provenance="measured"]')).not.toBeNull()
    expect(container.querySelector('[data-provenance="manual"]')).not.toBeNull()
    // The measured chip carries its origin and age in the tooltip.
    expect(container.querySelector('[data-provenance="measured"]')?.getAttribute('title'))
      .toContain('Saxlanan sorğu / total (sum)')
  })

  it('gives an internal node no chip of its own', () => {
    treeState.forest = [node('root', 'add', [leaf('a', 1, 'A')], 1)]
    const { container } = render(<MetricTreeEditor />)
    expect(container.querySelectorAll('[data-provenance]')).toHaveLength(1)
  })
})

describe('binding a leaf to a saved query', () => {
  it('does not offer the query option when there is nothing to bind to', () => {
    render(<MetricTreeEditor />)
    fireEvent.click(screen.getByRole('button', { name: /Kök metrik/ }))
    // An empty dropdown behind a choice is a dead end, not a feature.
    expect(screen.queryByRole('option', { name: /Saxlanan sorğudan/ })).toBeNull()
  })

  it('keeps save disabled until the binding is complete, then submits all three fields', async () => {
    treeState.sources = [source]
    render(<MetricTreeEditor />)
    fireEvent.click(screen.getByRole('button', { name: /Kök metrik/ }))

    fireEvent.change(screen.getByLabelText('Ad'), { target: { value: 'Satış' } })
    fireEvent.change(screen.getByLabelText('Mənbə'), { target: { value: 'query' } })

    const save = screen.getByRole('button', { name: /^Saxla$/ })
    // The API rejects a half-filled binding rather than storing a leaf that
    // resolves to `bad_binding`; the button has to agree instead of inviting a 422.
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Saxlanan sorğu'), { target: { value: 'sq-1' } })
    expect(save).toBeDisabled() // query chosen, column still empty
    fireEvent.change(screen.getByLabelText('Sütun'), { target: { value: 'total' } })
    expect(save).toBeEnabled()

    // The submit handler flips `busy` after an await, so the click has to be
    // flushed inside act() or React warns about the state update.
    await act(async () => {
      fireEvent.click(save)
    })
    expect(add).toHaveBeenCalledTimes(1)
    expect(add.mock.calls[0][0]).toMatchObject({
      name: 'Satış',
      source_kind: 'query',
      saved_query_id: 'sq-1',
      value_column: 'total',
      agg: 'sum',
    })
  })

  it('clears the column when the query changes', () => {
    treeState.sources = [source, { ...source, saved_query_id: 'sq-2', name: 'Digər', columns: ['x'] }]
    render(<MetricTreeEditor />)
    fireEvent.click(screen.getByRole('button', { name: /Kök metrik/ }))
    fireEvent.change(screen.getByLabelText('Mənbə'), { target: { value: 'query' } })
    fireEvent.change(screen.getByLabelText('Saxlanan sorğu'), { target: { value: 'sq-1' } })
    fireEvent.change(screen.getByLabelText('Sütun'), { target: { value: 'total' } })

    fireEvent.change(screen.getByLabelText('Saxlanan sorğu'), { target: { value: 'sq-2' } })
    // "total" does not exist in the new query's result; keeping it would submit
    // a binding that resolves to `column_missing` while the form looked filled.
    expect((screen.getByLabelText('Sütun') as HTMLSelectElement).value).toBe('')
  })
})
