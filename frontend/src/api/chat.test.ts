import { describe, expect, it, vi } from 'vitest'

vi.mock('./client', () => ({
  client: { post: vi.fn().mockResolvedValue({ data: {} }), get: vi.fn() },
}))

import { client } from './client'
import { aiRoom, approveAi, cancelAi, channelRoom, dmRoom, isAiMessage } from './chat'
import type { ChatMessage } from './chat'

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  room_key: 'ai:u1',
  author_id: 'bot',
  author_name: 'Nexus AI',
  content: 'salam',
  created_at: '2026-07-12T10:00:00Z',
  ...over,
})

describe('chat room keys', () => {
  it('builds a channel room key', () => {
    expect(channelRoom('w1', 'c1')).toBe('ws:w1:channel:c1')
  })

  it('builds a DM room key that is order-independent (sorted pair)', () => {
    expect(dmRoom('bob', 'ann')).toBe('dm:ann:bob')
    expect(dmRoom('ann', 'bob')).toBe(dmRoom('bob', 'ann'))
  })

  it('builds the personal AI room key', () => {
    expect(aiRoom('u1')).toBe('ai:u1')
  })
})

describe('isAiMessage', () => {
  it('trusts only the server-written meta.ai flag', () => {
    expect(isAiMessage(msg({ meta: { ai: true, kind: 'reply' } }))).toBe(true)
    expect(isAiMessage(msg({ meta: null }))).toBe(false)
    expect(isAiMessage(msg({ meta: undefined }))).toBe(false)
    // A user renaming themselves "Nexus AI" doesn't make their message an AI card.
    expect(isAiMessage(msg({ author_name: 'Nexus AI' }))).toBe(false)
  })
})

describe('AI plan actions', () => {
  it('approve/cancel POST the message id', async () => {
    await approveAi('m9')
    expect(client.post).toHaveBeenCalledWith('/chat/ai/approve', { message_id: 'm9' })
    await cancelAi('m9')
    expect(client.post).toHaveBeenCalledWith('/chat/ai/cancel', { message_id: 'm9' })
  })
})
