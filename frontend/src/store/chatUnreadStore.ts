import { create } from 'zustand'
import toast from 'react-hot-toast'
import i18n from '../i18n'
import * as api from '../api/chat'
import { wsBase } from '../lib/wsUrl'
import { useNotificationStore } from './notificationStore'
import type { AppNotification } from '../types'

/** App-lifetime mailbox socket: unread counts for every room, pushed live.
 *
 * Separate from chatStore on purpose — chatStore.close() wipes its state when
 * ChatPage unmounts, and this must outlive the page (the whole point is hearing
 * about rooms you are NOT looking at). */

export interface UnreadFrameState {
  rooms: Record<string, number>
  /** Frames received before the snapshot lands. The server registers the socket
   * BEFORE it runs the snapshot query — deliberately, so nothing falls through the
   * gap — which means a frame can beat the snapshot here. Dropping those would lose
   * messages; applying them blindly would double-count the ones the snapshot also
   * saw. Held until the snapshot's cutoff says which is which. */
  pending: UnreadFrame[]
  ready: boolean
  viewing: string | null
}

export interface UnreadFrame {
  room_key: string
  message_id: string
  author_name: string
  kind: 'text' | 'share'
  preview: string
  created_at: string
}

function wsUrl(ticket: string): string {
  return `${wsBase()}/ws/user?ticket=${encodeURIComponent(ticket)}`
}

// Non-serialisable/liveness state lives at module scope, never in the store
// (matches chatStore/collabStore). `epoch` invalidates everything a stale socket
// or a pending reconnect timer might try to do after stop() or a restart.
let ws: WebSocket | null = null
let epoch = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null

const PING_MS = 30_000
const PENDING_CAP = 200
/** Cap the backoff but never stop: this socket lives for the whole session, so
 * the page-scoped stores' `retries < 5` would silently kill the badge after one
 * deploy. Jitter matters too — without it a backend restart reconnects every
 * client on the same tick. */
const backoff = (n: number) => Math.min(1000 * 2 ** n, 30_000) + Math.random() * 1000

/** Server shape: {room_key: {unread, at}} where `at` is the created_at of the
 * newest message that snapshot counted. */
type Snapshot = Record<string, { unread: number; at: string }>

/** Room keys arrive off the socket and are used directly as object keys. The
 * mailbox is ours, but "the server would never send that" is an assumption about
 * today's server, not a property of this reducer — and `__proto__` reaching the
 * spread below would poison every later lookup. Dropped, not sanitised: a room
 * by that name does not exist, so there is no badge to render. */
/* Written out at each write site rather than behind a helper: the guard has to be
 * visible to a reader looking at the assignment, and dataflow analysis stops
 * treating it as a barrier once it hides behind a Set lookup. */

function bump(rooms: Record<string, number>, frame: UnreadFrame, viewing: string | null) {
  // Suppressed exactly when ChatPage will mark it read — the two share one
  // condition, so the badge and the read watermark cannot disagree.
  if (frame.room_key === viewing) return rooms
  const key = frame.room_key
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') return rooms
  return { ...rooms, [key]: (rooms[key] ?? 0) + 1 }
}

/** Pure reducer — every frame the mailbox can send, testable without a socket. */
export function applyUnreadFrame(
  frame: Record<string, unknown>,
  s: UnreadFrameState,
): Partial<UnreadFrameState> {
  switch (frame.type) {
    case 'unread_snapshot': {
      const snap = frame.rooms as Snapshot
      let rooms: Record<string, number> = {}
      for (const [room, v] of Object.entries(snap)) {
        if (room === '__proto__' || room === 'constructor' || room === 'prototype') continue
        rooms[room] = v.unread
      }
      // The room on screen is never badged. On reconnect the server still counts it
      // — the debounced markRead has not landed yet — so the snapshot would
      // otherwise light up the conversation the user is reading.
      if (s.viewing) delete rooms[s.viewing]
      // Replay only what the snapshot could NOT have seen. `at` is the cutoff it
      // read; anything strictly newer committed after the query and is ours to add.
      for (const p of s.pending) {
        const at = snap[p.room_key]?.at
        if (!at || p.created_at > at) rooms = bump(rooms, p, s.viewing)
      }
      return { rooms, pending: [], ready: true }
    }
    case 'chat_unread': {
      const f = frame as unknown as UnreadFrame
      if (!s.ready) return { pending: [...s.pending, f].slice(-PENDING_CAP) }
      return { rooms: bump(s.rooms, f, s.viewing) }
    }
    default:
      return {}
  }
}

interface ChatUnreadState extends UnreadFrameState {
  connected: boolean
  total: () => number
  start: () => Promise<void>
  stop: () => void
  setViewing: (roomKey: string | null) => void
  clearRoom: (roomKey: string) => void
}

function previewText(frame: Record<string, unknown>): string {
  const who = (frame.author_name as string) || '—'
  const body = (frame.preview as string) || ''
  return frame.kind === 'share'
    ? i18n.t('chatPage.sharedToast', { name: who })
    : `${who}: ${body}`
}

export const useChatUnreadStore = create<ChatUnreadState>((set, get) => {
  const teardown = () => {
    epoch += 1
    if (retryTimer) clearTimeout(retryTimer)
    if (pingTimer) clearInterval(pingTimer)
    retryTimer = null
    pingTimer = null
    if (ws) {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      ws = null
    }
  }

  const open = async (myEpoch: number, retries: number): Promise<void> => {
    if (myEpoch !== epoch) return
    let ticket: string
    try {
      // A fresh ticket per connect: they live 60s, so one cached at start() would
      // make every later reconnect a guaranteed 4401.
      ticket = await api.userTicket()
    } catch {
      if (myEpoch !== epoch) return
      retryTimer = setTimeout(() => open(myEpoch, retries + 1), backoff(retries))
      return
    }
    if (myEpoch !== epoch) return

    const sock = new WebSocket(wsUrl(ticket))
    ws = sock

    sock.onopen = () => {
      if (myEpoch !== epoch) return
      set({ connected: true })
      if (pingTimer) clearInterval(pingTimer)
      pingTimer = setInterval(() => {
        if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: 'ping' }))
      }, PING_MS)
    }
    sock.onmessage = (ev) => {
      if (myEpoch !== epoch) return
      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(ev.data)
      } catch {
        return
      }
      // The mailbox carries every per-user event, not just chat. Routing rather
      // than a second socket: notifications used to cost a 60s poll that refetched
      // 50 full rows to derive one integer.
      if (frame.type === 'notification') {
        useNotificationStore.getState().receive(frame as unknown as AppNotification)
        return
      }
      const before = get().rooms
      set((s) => applyUnreadFrame(frame, s))
      // Toast only for a message that actually moved a badge — never for the
      // snapshot, and never for the room already on screen. One toast id so a busy
      // channel replaces rather than carpets (precedent: client.ts network-error).
      if (frame.type === 'chat_unread' && get().rooms !== before) {
        toast(previewText(frame), { id: 'chat-unread' })
      }
    }
    sock.onclose = () => {
      if (myEpoch !== epoch) return
      set({ connected: false, ready: false, pending: [] })
      if (pingTimer) clearInterval(pingTimer)
      pingTimer = null
      retryTimer = setTimeout(() => open(myEpoch, retries + 1), backoff(retries))
    }
    sock.onerror = () => sock.close()
  }

  return {
    rooms: {},
    pending: [],
    viewing: null,
    connected: false,
    ready: false,

    // Derived, never stored: a `total` field would be a second source of truth
    // that clearRoom has to keep in sync, which is how badges get stuck.
    total: () => Object.values(get().rooms).reduce((a, b) => a + b, 0),

    start: async () => {
      teardown()
      const myEpoch = epoch
      await open(myEpoch, 0)
    },

    stop: () => {
      teardown()
      // Reset STATE too, not just the socket: logout is a pure SPA transition with
      // no reload, and zustand stores are module singletons — otherwise the next
      // user to sign in on this tab sees the previous one's counts.
      set({ rooms: {}, pending: [], viewing: null, connected: false, ready: false })
    },

    setViewing: (roomKey) => {
      set({ viewing: roomKey })
      if (roomKey) get().clearRoom(roomKey)
    },

    clearRoom: (roomKey) => {
      const { [roomKey]: _drop, ...rest } = get().rooms
      set({ rooms: rest })
    },
  }
})
