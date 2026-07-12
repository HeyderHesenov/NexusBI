import { describe, expect, it } from 'vitest'
import { channelRoom, dmRoom } from './chat'

describe('chat room keys', () => {
  it('builds a channel room key', () => {
    expect(channelRoom('w1', 'c1')).toBe('ws:w1:channel:c1')
  })

  it('builds a DM room key that is order-independent (sorted pair)', () => {
    expect(dmRoom('bob', 'ann')).toBe('dm:ann:bob')
    expect(dmRoom('ann', 'bob')).toBe(dmRoom('bob', 'ann'))
  })
})
