import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/chat', () => ({
  listChannels: vi.fn(),
  dmPeers: vi.fn(),
}))

import { applyFrame, useChatStore } from './chatStore'
import type { ChatMessage } from '../api/chat'
import * as api from '../api/chat'

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  room_key: 'ws:w1:channel:c1',
  author_id: 'u2',
  author_name: 'Peer',
  content: 'salam',
  created_at: '2026-07-12T10:00:00Z',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  useChatStore.setState({ channels: [], dmPeers: [], messages: [], activeRoom: null, typing: {} })
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

describe('applyFrame', () => {
  const base = { messages: [] as ChatMessage[], participants: [], typing: {} }

  it('typing adds an entry keyed by user id', () => {
    const out = applyFrame({ type: 'typing', user_id: 'u2', name: 'Peer' }, base)
    expect(out.typing).toEqual({ u2: 'Peer' })
  })

  it('chat appends the message and clears its author typing hint', () => {
    const state = { ...base, typing: { u2: 'Peer', u3: 'Other' } }
    const out = applyFrame({ type: 'chat', message: msg() }, state)
    expect(out.messages).toHaveLength(1)
    expect(out.typing).toEqual({ u3: 'Other' })
  })

  it('chat_update replaces a message by id and leaves the rest alone', () => {
    const state = { ...base, messages: [msg(), msg({ id: 'm2', content: 'iki' })] }
    const out = applyFrame(
      { type: 'chat_update', message: msg({ id: 'm2', content: 'yeni' }) },
      state,
    )
    expect(out.messages?.map((m) => m.content)).toEqual(['salam', 'yeni'])
  })

  it('leave removes the participant by conn_id', () => {
    const state = {
      ...base,
      participants: [{ conn_id: 'a', user_id: 'u2', name: 'Peer', color: '#000' }],
    }
    const out = applyFrame({ type: 'leave', conn_id: 'a' }, state)
    expect(out.participants).toEqual([])
  })

  it('unknown frames are a no-op', () => {
    expect(applyFrame({ type: 'pong' }, base)).toEqual({})
  })
})
