import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/chat', () => ({
  listChannels: vi.fn(),
  dmPeers: vi.fn(),
}))

import { useChatStore } from './chatStore'
import * as api from '../api/chat'

beforeEach(() => {
  vi.clearAllMocks()
  useChatStore.setState({ channels: [], dmPeers: [], messages: [], activeRoom: null })
})

describe('chatStore', () => {
  it('loadChannels fetches and stores the workspace channels', async () => {
    vi.mocked(api.listChannels).mockResolvedValue([
      { id: 'c1', workspace_id: 'w1', name: 'ümumi', created_by: 'u', created_at: '', unread: 2 },
    ])
    await useChatStore.getState().loadChannels('w1')
    expect(api.listChannels).toHaveBeenCalledWith('w1')
    expect(useChatStore.getState().channels.map((c) => c.name)).toEqual(['ümumi'])
    expect(useChatStore.getState().channels[0].unread).toBe(2)
  })

  it('loadDmPeers fetches and stores DM peers', async () => {
    vi.mocked(api.dmPeers).mockResolvedValue([
      { user_id: 'u2', email: 'p@x.io', full_name: 'Peer' },
    ])
    await useChatStore.getState().loadDmPeers()
    expect(useChatStore.getState().dmPeers[0].email).toBe('p@x.io')
  })
})
