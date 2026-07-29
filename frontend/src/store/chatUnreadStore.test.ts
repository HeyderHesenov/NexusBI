import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeWS, installFakeWebSocket } from '../test/fakeWebSocket'

vi.mock('../api/chat', () => ({
  userTicket: vi.fn(async () => 'tkt'),
}))
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn() }) }))

let ws: ReturnType<typeof installFakeWebSocket>
// The store keeps its socket + epoch at module scope, so every test needs a fresh
// module — the same reason notificationStore.test.ts does this.
let useChatUnreadStore: typeof import('./chatUnreadStore')['useChatUnreadStore']
let applyUnreadFrame: typeof import('./chatUnreadStore')['applyUnreadFrame']

beforeEach(async () => {
  vi.resetModules()
  ws = installFakeWebSocket()
  const mod = await import('./chatUnreadStore')
  useChatUnreadStore = mod.useChatUnreadStore
  applyUnreadFrame = mod.applyUnreadFrame
})
afterEach(() => {
  ws.restore()
  vi.useRealTimers()
})

// `at` is the created_at of the newest message that snapshot counted.
const snapshot = (rooms: Record<string, { unread: number; at: string }>) => ({
  type: 'unread_snapshot',
  rooms,
})
const snap = (room: string, unread: number, at = '2026-07-17T10:00:00Z') => ({
  [room]: { unread, at },
})
const unread = (roomKey: string, messageId: string, createdAt = '2026-07-17T10:00:00Z') => ({
  type: 'chat_unread',
  room_key: roomKey,
  message_id: messageId,
  author_name: 'Aygün',
  kind: 'text',
  preview: 'salam',
  created_at: createdAt,
})

describe('applyUnreadFrame', () => {
  const base = { rooms: {}, pending: [], ready: true, viewing: null as string | null }

  it('replaces state on a snapshot', () => {
    const next = applyUnreadFrame(snapshot(snap('dm:a:b', 3)), { ...base, rooms: { old: 9 } })
    expect(next.rooms).toEqual({ 'dm:a:b': 3 })
  })

  it('increments the room a message arrived in', () => {
    const next = applyUnreadFrame(unread('dm:a:b', 'm1'), { ...base, rooms: { 'dm:a:b': 1 } })
    expect(next.rooms).toEqual({ 'dm:a:b': 2 })
  })

  it('ignores a message for the room being viewed — that is exactly when the page marks it read', () => {
    const state = { ...base, rooms: { 'dm:a:b': 0, other: 1 }, viewing: 'dm:a:b' }
    const next = applyUnreadFrame(unread('dm:a:b', 'm1'), state)
    expect(next.rooms).toEqual({ 'dm:a:b': 0, other: 1 })
    // Same reference, so nothing re-renders and no toast fires.
    expect(next.rooms).toBe(state.rooms)
  })

  it('buffers frames until the snapshot arrives rather than counting them blind', () => {
    const next = applyUnreadFrame(unread('dm:a:b', 'm1'), { ...base, ready: false })
    expect(next.rooms).toBeUndefined()
    expect(next.pending).toHaveLength(1)
  })

  it('ignores unknown frames rather than corrupting state', () => {
    expect(applyUnreadFrame({ type: 'pong' }, base)).toEqual({})
  })
})

describe('chatUnreadStore', () => {
  it('derives the total from the rooms map — one source of truth', async () => {
    await useChatUnreadStore.getState().start()
    ws.emit(ws.last(), snapshot({ ...snap('a', 2), ...snap('b', 3) }))
    expect(useChatUnreadStore.getState().total()).toBe(5)
  })

  it('keeps a message that committed AFTER the snapshot query but raced ahead of it', async () => {
    await useChatUnreadStore.getState().start()
    const sock = ws.last()
    // The server registers the socket before running the snapshot query, so this
    // frame can beat the snapshot. It is newer than the cutoff → it is ours to add.
    ws.emit(sock, unread('a', 'm-late', '2026-07-17T10:00:05Z'))
    expect(useChatUnreadStore.getState().rooms).toEqual({})
    ws.emit(sock, snapshot(snap('a', 1, '2026-07-17T10:00:00Z')))
    expect(useChatUnreadStore.getState().rooms).toEqual({ a: 2 })
  })

  it('does not double-count a raced frame the snapshot already counted', async () => {
    await useChatUnreadStore.getState().start()
    const sock = ws.last()
    // Committed before the query read → at >= its created_at → already in the 1.
    ws.emit(sock, unread('a', 'm1', '2026-07-17T09:59:00Z'))
    ws.emit(sock, snapshot(snap('a', 1, '2026-07-17T10:00:00Z')))
    expect(useChatUnreadStore.getState().rooms).toEqual({ a: 1 })
  })

  it('applies frames directly once the snapshot has landed', async () => {
    await useChatUnreadStore.getState().start()
    const sock = ws.last()
    ws.emit(sock, snapshot(snap('a', 1)))
    ws.emit(sock, unread('a', 'm2', '2026-07-17T11:00:00Z'))
    expect(useChatUnreadStore.getState().rooms).toEqual({ a: 2 })
  })

  it('clears a room locally when it is marked read', async () => {
    await useChatUnreadStore.getState().start()
    ws.emit(ws.last(), snapshot({ ...snap('a', 2), ...snap('b', 1) }))
    useChatUnreadStore.getState().clearRoom('a')
    expect(useChatUnreadStore.getState().rooms).toEqual({ b: 1 })
    expect(useChatUnreadStore.getState().total()).toBe(1)
  })

  it('reconnects with backoff and does not give up after 5 tries', async () => {
    vi.useFakeTimers()
    await useChatUnreadStore.getState().start()
    for (let i = 0; i < 8; i += 1) {
      ws.last().onclose?.()
      await vi.advanceTimersByTimeAsync(60_000)
    }
    // An app-lifetime socket that gives up silently stops the badge for the whole
    // session; the page-scoped stores' `retries < 5` must not be copied here.
    expect(ws.all().length).toBeGreaterThan(6)
  })

  it('stop() resets state as well as the socket, so the next user never sees the last one\'s count', async () => {
    await useChatUnreadStore.getState().start()
    ws.emit(ws.last(), snapshot(snap('a', 4)))
    useChatUnreadStore.getState().stop()
    expect(useChatUnreadStore.getState().rooms).toEqual({})
    expect(useChatUnreadStore.getState().total()).toBe(0)
  })

  it('stop() prevents a pending reconnect from resurrecting the socket', async () => {
    vi.useFakeTimers()
    await useChatUnreadStore.getState().start()
    const before = ws.all().length
    ws.last().onclose?.()
    useChatUnreadStore.getState().stop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(ws.all().length).toBe(before)
  })

  it('sends a keepalive ping so idle proxies do not reap the socket', async () => {
    vi.useFakeTimers()
    await useChatUnreadStore.getState().start()
    const sock = ws.last()
    sock.onopen?.()
    await vi.advanceTimersByTimeAsync(31_000)
    expect(sock.sent.map((s) => JSON.parse(s).type)).toContain('ping')
  })

  it('reuses FakeWS OPEN semantics without leaking sockets across starts', async () => {
    await useChatUnreadStore.getState().start()
    await useChatUnreadStore.getState().start()
    const open = ws.all().filter((s: FakeWS) => s.readyState === FakeWS.OPEN)
    expect(open.length).toBe(1)
  })
})

describe('chatUnreadStore reconnect while reading', () => {
  it('does not badge the room the user is looking at when a snapshot lands', async () => {
    await useChatUnreadStore.getState().start()
    useChatUnreadStore.getState().setViewing('a')
    // A reconnect re-snapshots. The server still counts room `a` as unread — the
    // debounced markRead has not landed yet — but the user is reading it.
    ws.emit(ws.last(), snapshot({ ...snap('a', 3), ...snap('b', 1) }))
    expect(useChatUnreadStore.getState().rooms).toEqual({ b: 1 })
    expect(useChatUnreadStore.getState().total()).toBe(1)
  })
})
