import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedQuery } from '../types'
import type { useSavedQueryStore } from '../store/savedQueryStore'

type SavedQueryState = ReturnType<typeof useSavedQueryStore>

// Typed on purpose. An untyped literal lets the fixture and the mocks drift
// away from the real modules without tsc noticing, and the drift then surfaces
// inside an unrelated assertion as "x is not a function" instead of pointing at
// the mock. `satisfies typeof import(...)` below turns any new export, renamed
// export or changed signature into a compile error.
const savedQuery: SavedQuery = {
  id: 'sq-1',
  datasource_id: null,
  name: 'Aylıq gəlir',
  nl_query: 'aylıq gəlir nə qədərdir',
  schedule: 'daily',
  last_run_at: '2026-08-01T09:00:00Z',
  last_query_log_id: null,
  created_at: '2026-08-01T09:00:00Z',
}

const listSubscriptions = vi.fn()
const createSubscription = vi.fn()
const deleteSubscription = vi.fn()
vi.mock('../api/reportSubscription', () => ({
  listSubscriptions: (...a: unknown[]) => listSubscriptions(...a),
  createSubscription: (...a: unknown[]) => createSubscription(...a),
  deleteSubscription: (...a: unknown[]) => deleteSubscription(...a),
} satisfies typeof import('../api/reportSubscription')))

// All eight exports, not just the four this page reaches for today. The page's
// import graph is free to grow, and a partial mock fails as
// "listNotifications is not a function" inside whatever assertion happens to
// run first, which points at the wrong file.
vi.mock('../api/alert', () => ({
  listAlerts: vi.fn().mockResolvedValue([]),
  createAlert: vi.fn(),
  updateAlert: vi.fn(),
  removeAlert: vi.fn(),
  listNotifications: vi.fn().mockResolvedValue([]),
  readAll: vi.fn(),
  readOne: vi.fn(),
  buildDigest: vi.fn(),
} satisfies typeof import('../api/alert')))

vi.mock('../components/chat/ShareToChatButton', () => ({
  ShareToChatButton: () => null,
}))

const load = vi.fn()
vi.mock('../store/savedQueryStore', () => ({
  useSavedQueryStore: (): SavedQueryState => ({
    items: [savedQuery],
    loading: false,
    load,
    save: vi.fn(),
    run: vi.fn(),
    remove: vi.fn(),
    setSchedule: vi.fn(),
  }),
}))

import { ReportsPage } from './ReportsPage'

/** Open the delivery modal and wait for its one existing subscription row. */
const openDeliveryModal = async () => {
  render(<ReportsPage />)
  fireEvent.click(screen.getByTitle('PDF/Excel çatdırılması'))
  return screen.findByText('ceo@nexusbi.az')
}

describe('DeliveryModal delete', () => {
  beforeEach(() => {
    load.mockReset().mockResolvedValue(undefined)
    listSubscriptions.mockReset().mockResolvedValue([
      { id: 'sub-1', recipient: 'ceo@nexusbi.az', format: 'pdf', schedule: 'daily' },
    ])
    createSubscription.mockReset()
    deleteSubscription.mockReset()
  })

  it('keeps the row when the server refuses the delete', async () => {
    // The old code swallowed the rejection and filtered the row out anyway, so a
    // 429 or a 500 read as "it is gone" while the schedule kept mailing reports.
    deleteSubscription.mockRejectedValue(new Error('429'))
    await openDeliveryModal()

    fireEvent.click(screen.getByLabelText('Sil'))

    await waitFor(() => expect(deleteSubscription).toHaveBeenCalledWith('sub-1'))
    expect(screen.getByText('ceo@nexusbi.az')).toBeInTheDocument()
  })

  it('drops the row once the server confirms', async () => {
    // The other half of the guard: refusing to remove anything would be just as
    // wrong, so pin the success path against an over-correction.
    deleteSubscription.mockResolvedValue(undefined)
    await openDeliveryModal()

    fireEvent.click(screen.getByLabelText('Sil'))

    await waitFor(() => expect(screen.queryByText('ceo@nexusbi.az')).toBeNull())
  })

  it('ignores a second click on the row already being deleted', async () => {
    // The row now survives until the response lands, so a double-click would
    // send two DELETEs; the second 404s and toasts a failure on top of a delete
    // that succeeded. What blocks it is the button's `disabled` — measured by
    // removing that attribute, which fails this test and only this one.
    let release: () => void = () => {}
    deleteSubscription.mockReturnValue(new Promise<void>((r) => { release = r }))
    await openDeliveryModal()

    const button = screen.getByLabelText('Sil')
    fireEvent.click(button)
    fireEvent.click(button)

    expect(deleteSubscription).toHaveBeenCalledTimes(1)
    release()
    await waitFor(() => expect(screen.queryByText('ceo@nexusbi.az')).toBeNull())
  })

  it('still deletes a DIFFERENT row while one is in flight', async () => {
    // Only the in-flight row's button is disabled, so the in-flight state must
    // be keyed on that row. This failed against an `if (deleting) return` early
    // return, which swallowed clicks on every other row while their buttons
    // stayed enabled — the same lie about state this whole change removes.
    listSubscriptions.mockResolvedValue([
      { id: 'sub-1', recipient: 'ceo@nexusbi.az', format: 'pdf', schedule: 'daily' },
      { id: 'sub-2', recipient: 'cfo@nexusbi.az', format: 'xlsx', schedule: 'weekly' },
    ])
    deleteSubscription.mockReturnValue(new Promise<void>(() => {}))  // never settles
    await openDeliveryModal()

    const [first, second] = screen.getAllByLabelText('Sil')
    fireEvent.click(first)
    fireEvent.click(second)

    expect(deleteSubscription).toHaveBeenNthCalledWith(1, 'sub-1')
    expect(deleteSubscription).toHaveBeenNthCalledWith(2, 'sub-2')
  })
})
