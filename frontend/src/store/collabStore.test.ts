import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useCollabStore } from './collabStore'

// Minimal fake WebSocket: records instances, never auto-fires handlers so tests
// drive onopen/onmessage/onclose explicitly.
class FakeWS {
  static OPEN = 1
  static instances: FakeWS[] = []
  url: string
  readyState = FakeWS.OPEN
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  constructor(url: string) {
    this.url = url
    FakeWS.instances.push(this)
  }
  send(d: string) {
    this.sent.push(d)
  }
  close() {
    this.readyState = 3
  }
}

const origWS = globalThis.WebSocket

beforeEach(() => {
  FakeWS.instances = []
  globalThis.WebSocket = FakeWS as unknown as typeof WebSocket
  useCollabStore.getState().disconnect()
})
afterEach(() => {
  globalThis.WebSocket = origWS
})

const last = () => FakeWS.instances[FakeWS.instances.length - 1]
const msg = (ws: FakeWS, obj: unknown) => ws.onmessage?.({ data: JSON.stringify(obj) })

describe('collabStore', () => {
  it('opens a socket and marks connected on open', () => {
    useCollabStore.getState().connect('d1', { token: 't' }, [])
    const ws = last()
    expect(ws.url).toContain('/ws/dashboard/d1')
    ws.onopen?.()
    expect(useCollabStore.getState().connected).toBe(true)
  })

  it('appends chat messages and updates cursors', () => {
    useCollabStore.getState().connect('d1', { token: 't' }, [])
    const ws = last()
    msg(ws, { type: 'chat', comment: { id: 'c1', content: 'hi' } })
    expect(useCollabStore.getState().messages).toHaveLength(1)
    msg(ws, { type: 'cursor', conn_id: 'u1', name: 'A', color: '#000', x: 5, y: 6 })
    expect(useCollabStore.getState().cursors.u1).toMatchObject({ x: 5, y: 6 })
  })

  it('ignores frames from a superseded (stale-epoch) socket', () => {
    useCollabStore.getState().connect('d1', { token: 't' }, [])
    const stale = last()
    // A second connect bumps the epoch and supersedes the first socket.
    useCollabStore.getState().connect('d1', { token: 't' }, [])
    const fresh = last()
    msg(stale, { type: 'chat', comment: { id: 'old', content: 'stale' } })
    expect(useCollabStore.getState().messages).toHaveLength(0)
    msg(fresh, { type: 'chat', comment: { id: 'new', content: 'fresh' } })
    expect(useCollabStore.getState().messages).toHaveLength(1)
  })

  it('ignores a bad JSON frame without throwing', () => {
    useCollabStore.getState().connect('d1', { token: 't' }, [])
    const ws = last()
    expect(() => ws.onmessage?.({ data: '{bad' })).not.toThrow()
    expect(useCollabStore.getState().messages).toHaveLength(0)
  })

  it('disconnect clears state', () => {
    useCollabStore.getState().connect('d1', { token: 't' }, [])
    last().onopen?.()
    useCollabStore.getState().disconnect()
    expect(useCollabStore.getState().connected).toBe(false)
    expect(useCollabStore.getState().participants).toEqual([])
  })

  it('prefers the ticket over the token in the socket URL', () => {
    useCollabStore.getState().connect('d2', { ticket: 'TKT', token: 'JWT' }, [])
    expect(last().url).toContain('ticket=TKT')
    expect(last().url).not.toContain('token=')
  })
})
