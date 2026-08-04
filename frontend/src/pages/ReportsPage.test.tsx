import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const savedQuery = {
  id: 'sq-1',
  name: 'Aylıq gəlir',
  nl_query: 'aylıq gəlir nə qədərdir',
  schedule: 'daily',
  last_run_at: '2026-08-01T09:00:00Z',
}

const listSubscriptions = vi.fn()
const createSubscription = vi.fn()
const deleteSubscription = vi.fn()
vi.mock('../api/reportSubscription', () => ({
  listSubscriptions: (...a: unknown[]) => listSubscriptions(...a),
  createSubscription: (...a: unknown[]) => createSubscription(...a),
  deleteSubscription: (...a: unknown[]) => deleteSubscription(...a),
}))

vi.mock('../api/alert', () => ({
  listAlerts: vi.fn().mockResolvedValue([]),
  createAlert: vi.fn(),
  updateAlert: vi.fn(),
  removeAlert: vi.fn(),
}))

vi.mock('../components/chat/ShareToChatButton', () => ({
  ShareToChatButton: () => null,
}))

const load = vi.fn()
vi.mock('../store/savedQueryStore', () => ({
  useSavedQueryStore: () => ({
    items: [savedQuery],
    loading: false,
    load,
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
})
