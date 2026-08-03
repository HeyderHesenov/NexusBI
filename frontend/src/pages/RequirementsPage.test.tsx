import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataSource, RequirementDoc } from '../types'

const build = vi.fn()
const loadSources = vi.fn()

let reqState: Record<string, unknown>
let dsState: { sources: DataSource[]; load: typeof loadSources }

vi.mock('../store/requirementStore', () => ({
  useRequirementStore: Object.assign(() => reqState, { getState: () => reqState }),
}))
vi.mock('../store/datasourceStore', () => ({
  useDatasourceStore: Object.assign(() => dsState, { getState: () => dsState }),
}))
vi.mock('../store/dashboardStore', () => ({
  useDashboardStore: Object.assign(
    () => ({ loadList: vi.fn(), open: vi.fn() }),
    { getState: () => ({ loadList: vi.fn(), open: vi.fn() }) },
  ),
}))

import { RequirementsPage } from './RequirementsPage'

const source = (id: string, name: string): DataSource => ({
  id,
  name,
  db_type: 'postgresql',
  created_at: '2024-01-01T00:00:00Z',
})

const doc: RequirementDoc = {
  id: 'doc-1',
  name: 'BRD',
  kpis: [{ name: 'Gəlir', question: 'Aylıq gəlir nədir?', rationale: '', requirement_ref: 'R1' }],
  dashboard_id: null,
  created_at: '2024-01-01T00:00:00Z',
}

// Test i18n is initialized with Azerbaijani (see src/test/setup.ts).
const SOURCE_LABEL = 'Dashboard-un qurulacağı mənbə'
const BUILD = /Dashboard qur/

const renderPage = () =>
  render(
    <MemoryRouter>
      <RequirementsPage />
    </MemoryRouter>,
  )

describe('RequirementsPage source selection', () => {
  beforeEach(() => {
    build.mockReset().mockResolvedValue(null)
    loadSources.mockReset().mockResolvedValue(undefined)
    reqState = { doc, extracting: false, building: false, extract: vi.fn(), build, reset: vi.fn() }
    dsState = { sources: [source('a', 'Acme Postgres'), source('b', 'Sales CSV')], load: loadSources }
  })

  it('builds against the source you picked', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(SOURCE_LABEL), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: BUILD }))
    expect(build).toHaveBeenCalledWith('a', ['Aylıq gəlir nədir?'])
  })

  it('drops a selection whose source disappeared, instead of building against a dead id', () => {
    // The assertion is on what build() receives, NOT on the select's value: a
    // select holding a value with no matching option reports '' either way, so
    // reading the DOM would pass against the unfixed code too. The dead id is
    // only visible in what the page posts.
    const { rerender } = renderPage()
    fireEvent.change(screen.getByLabelText(SOURCE_LABEL), { target: { value: 'a' } })

    // datasourceStore.remove() filters the list and clears queryStore's
    // selection — it cannot reach this page's local state.
    dsState = { sources: [source('b', 'Sales CSV')], load: loadSources }
    rerender(
      <MemoryRouter>
        <RequirementsPage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: BUILD }))
    expect(build).toHaveBeenCalledWith(null, ['Aylıq gəlir nədir?'])
  })

  it('keeps a selection that still exists when the list refreshes', () => {
    const { rerender } = renderPage()
    fireEvent.change(screen.getByLabelText(SOURCE_LABEL), { target: { value: 'a' } })

    // A new arrival must not disturb an existing, still-valid choice.
    dsState = {
      sources: [source('a', 'Acme Postgres'), source('b', 'Sales CSV'), source('c', 'New')],
      load: loadSources,
    }
    rerender(
      <MemoryRouter>
        <RequirementsPage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: BUILD }))
    expect(build).toHaveBeenCalledWith('a', ['Aylıq gəlir nədir?'])
  })
})
