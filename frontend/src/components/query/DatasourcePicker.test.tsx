import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataSource } from '../../types'

const load = vi.fn()
const setDatasource = vi.fn()

let dsState: { sources: DataSource[]; loading: boolean; load: typeof load }
let qsState: { datasourceId: string | null; setDatasource: typeof setDatasource }

vi.mock('../../store/datasourceStore', () => ({
  useDatasourceStore: Object.assign(() => dsState, { getState: () => dsState }),
}))
vi.mock('../../store/queryStore', () => ({
  useQueryStore: Object.assign(() => qsState, { getState: () => qsState }),
}))

import { DatasourcePicker } from './DatasourcePicker'

const source = (id: string, name: string): DataSource => ({
  id,
  name,
  db_type: 'postgresql',
  created_at: '2024-01-01T00:00:00Z',
})

const renderPicker = () =>
  render(
    <MemoryRouter>
      <DatasourcePicker />
    </MemoryRouter>,
  )

// Test i18n is initialized with Azerbaijani (see src/test/setup.ts).
const ADD = 'Mənbə əlavə et'

describe('DatasourcePicker', () => {
  beforeEach(() => {
    load.mockReset().mockResolvedValue(undefined)
    setDatasource.mockReset()
    dsState = { sources: [], loading: false, load }
    qsState = { datasourceId: null, setDatasource }
  })

  it('spells out the action once the load settles and you still have no sources', async () => {
    renderPicker()
    await waitFor(() => expect(screen.getByRole('link', { name: ADD })).toHaveTextContent(ADD))
  })

  it('drops to icon-only once you have sources, but stays named for assistive tech', async () => {
    load.mockImplementation(async () => {
      dsState = { sources: [source('a', 'Acme Postgres')], loading: false, load }
    })
    renderPicker()
    await waitFor(() => expect(load).toHaveBeenCalled())
    const link = screen.getByRole('link', { name: ADD })
    expect(link).toHaveTextContent('')
    expect(link).toHaveAttribute('title', ADD)
  })

  it('holds the label back on the very first paint, before the load settles', () => {
    // The store starts `loading: false` and only flips inside the effect, so
    // gating on it would still let the label paint for one frame. No await here
    // on purpose: this asserts the state of the first commit.
    load.mockReturnValue(new Promise(() => {})) // never settles
    renderPicker()
    expect(screen.getByRole('link', { name: ADD })).toHaveTextContent('')
  })

  it('does not repeat the visible label in a tooltip', async () => {
    renderPicker()
    await waitFor(() => expect(screen.getByRole('link', { name: ADD })).toHaveTextContent(ADD))
    expect(screen.getByRole('link', { name: ADD })).not.toHaveAttribute('title')
  })

  it('points at where sources are added', async () => {
    renderPicker()
    await waitFor(() => expect(load).toHaveBeenCalled())
    expect(screen.getByRole('link', { name: ADD })).toHaveAttribute('href', '/sources')
  })

  it('drops a selection whose source was deleted in another tab', async () => {
    qsState.datasourceId = 'gone'
    load.mockImplementation(async () => {
      dsState = { sources: [source('a', 'Acme Postgres')], loading: false, load }
    })
    renderPicker()
    await waitFor(() => expect(setDatasource).toHaveBeenCalledWith(null))
  })

  it('keeps a selection that still exists', async () => {
    qsState.datasourceId = 'a'
    load.mockImplementation(async () => {
      dsState = { sources: [source('a', 'Acme Postgres')], loading: false, load }
    })
    renderPicker()
    await waitFor(() => expect(load).toHaveBeenCalled())
    expect(setDatasource).not.toHaveBeenCalled()
  })
})
