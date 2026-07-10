import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const items = [
  { id: 'a', natural_language: 'Aylıq gəlir', generated_sql: 'SELECT 1', chart_type: 'line', execution_time_ms: 300, created_at: '2024-03-01T00:00:00Z' },
  { id: 'b', natural_language: 'Top məhsullar', generated_sql: 'SELECT 2', chart_type: 'bar', execution_time_ms: 100, created_at: '2024-01-01T00:00:00Z' },
]

const getHistory = vi.fn()
const deleteQuery = vi.fn()
vi.mock('../api/query', () => ({
  getHistory: (...a: unknown[]) => getHistory(...a),
  deleteQuery: (...a: unknown[]) => deleteQuery(...a),
}))

const ask = vi.fn()
const runSql = vi.fn()
const deleteHistoryItem = vi.fn()
vi.mock('../store/queryStore', () => ({
  useQueryStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ ask, runSql, deleteHistoryItem }),
}))

import { HistoryPage } from './HistoryPage'

const renderPage = () =>
  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>,
  )

describe('HistoryPage', () => {
  beforeEach(() => {
    getHistory.mockReset().mockResolvedValue({ items, page: 1, limit: 50, total: 2 })
    deleteQuery.mockReset().mockResolvedValue(undefined)
    ask.mockReset().mockResolvedValue(undefined)
    runSql.mockReset().mockResolvedValue(undefined)
  })

  it('loads and lists history rows', async () => {
    renderPage()
    expect(await screen.findByText('Aylıq gəlir')).toBeInTheDocument()
    expect(screen.getByText('Top məhsullar')).toBeInTheDocument()
  })

  it('search narrows the visible rows', async () => {
    renderPage()
    await screen.findByText('Aylıq gəlir')
    fireEvent.change(screen.getByPlaceholderText('Sorğularda axtar…'), { target: { value: 'gəlir' } })
    expect(screen.queryByText('Top məhsullar')).toBeNull()
    expect(screen.getByText('Aylıq gəlir')).toBeInTheDocument()
  })

  it('re-running an NL row calls the query store ask()', async () => {
    renderPage()
    await screen.findByText('Aylıq gəlir')
    fireEvent.click(screen.getByText('Aylıq gəlir'))
    expect(ask).toHaveBeenCalledWith('Aylıq gəlir')
    expect(runSql).not.toHaveBeenCalled()
  })

  it('shows the empty state when there is no history', async () => {
    getHistory.mockResolvedValue({ items: [], page: 1, limit: 50, total: 0 })
    renderPage()
    expect(await screen.findByText('Hələ sorğu yoxdur.')).toBeInTheDocument()
  })
})
