import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Typed against the real module so a new export or a changed signature is a
// compile error rather than an opaque "x is not a function" at runtime.
const listChannels = vi.fn()
const deleteChannel = vi.fn()
vi.mock('../api/integration', () => ({
  listChannels: (...a: unknown[]) => listChannels(...a),
  createChannel: vi.fn(),
  testChannel: vi.fn(),
  deleteChannel: (...a: unknown[]) => deleteChannel(...a),
} satisfies typeof import('../api/integration')))

import { IntegrationsPanel } from './IntegrationsPanel'
import type { IntegrationChannel } from '../api/integration'

const channel: IntegrationChannel = {
  id: 'ch-1',
  type: 'slack',
  name: 'Satış kanalı',
  active: true,
  created_at: '2026-08-01T09:00:00Z',
}

describe('IntegrationsPanel — deleting a channel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listChannels.mockResolvedValue([channel])
  })

  const deleteButton = async () => {
    render(<IntegrationsPanel />)
    const row = await screen.findByText('Satış kanalı')
    // The two icon buttons are title-only; take the delete one by position
    // rather than by matching an <svg>, which would also match the test button.
    const buttons = row.closest('li')!.querySelectorAll('button')
    expect(buttons).toHaveLength(2)
    return buttons[1]
  }

  it('keeps the row when the server refuses the delete', async () => {
    // The bug this replaces: the rejection was swallowed and the row filtered
    // out regardless, so a refused delete read as done while the channel kept
    // receiving every alert.
    deleteChannel.mockRejectedValue(new Error('429'))

    fireEvent.click(await deleteButton())

    await waitFor(() => expect(deleteChannel).toHaveBeenCalledWith('ch-1'))
    expect(screen.getByText('Satış kanalı')).toBeInTheDocument()
  })

  it('removes the row once the server confirms', async () => {
    deleteChannel.mockResolvedValue(undefined)

    fireEvent.click(await deleteButton())

    await waitFor(() => expect(screen.queryByText('Satış kanalı')).not.toBeInTheDocument())
  })
})
