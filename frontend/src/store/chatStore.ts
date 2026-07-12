import { create } from 'zustand'
import * as api from '../api/chat'
import type { Channel, ChatMessage, DMPeer } from '../api/chat'

export interface Participant {
  conn_id: string
  user_id: string | null
  name: string
  color: string
}

function wsUrl(roomKey: string, ticket: string): string {
  const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1'
  const base = apiBase.replace(/^http/, 'ws').replace(/\/api\/v1\/?$/, '')
  // The room key contains ':' — encode it as one path segment; Starlette decodes it.
  return `${base}/ws/room/${encodeURIComponent(roomKey)}?ticket=${encodeURIComponent(ticket)}`
}

// Module-scoped socket + epoch guard: only one chat socket is ever open, and a
// stale socket (after switching rooms / StrictMode double-invoke) can't mutate state.
let ws: WebSocket | null = null
let epoch = 0
// A typing hint is ephemeral — each sender's entry ages out unless refreshed.
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()
const TYPING_TTL_MS = 4000
let lastTypingSentAt = 0

interface ChatState {
  activeRoom: string | null
  connected: boolean
  messages: ChatMessage[]
  participants: Participant[]
  typing: Record<string, string> // user_id → display name
  channels: Channel[]
  dmPeers: DMPeer[]
  openRoom: (roomKey: string, ticket: string, history: ChatMessage[]) => void
  send: (text: string) => void
  sendTyping: () => void
  close: () => void
  loadChannels: (workspaceId: string) => Promise<void>
  loadDmPeers: () => Promise<void>
}

type FrameState = Pick<ChatState, 'messages' | 'participants' | 'typing'>

/** Pure frame reducer — everything the socket can say, testable without a WebSocket. */
export function applyFrame(
  msg: Record<string, unknown>,
  s: FrameState,
): Partial<FrameState> {
  switch (msg.type) {
    case 'presence':
      return { participants: msg.participants as Participant[] }
    case 'join':
      return { participants: [...s.participants, msg.participant as Participant] }
    case 'leave':
      return { participants: s.participants.filter((p) => p.conn_id !== msg.conn_id) }
    case 'chat': {
      const message = msg.message as ChatMessage
      // A delivered message supersedes its author's typing hint.
      const typing = { ...s.typing }
      delete typing[message.author_id]
      return { messages: [...s.messages, message], typing }
    }
    case 'chat_update': {
      const updated = msg.message as ChatMessage
      return { messages: s.messages.map((m) => (m.id === updated.id ? updated : m)) }
    }
    case 'typing':
      return { typing: { ...s.typing, [msg.user_id as string]: msg.name as string } }
    default:
      return {}
  }
}

function clearTypingTimers() {
  typingTimers.forEach((t) => clearTimeout(t))
  typingTimers.clear()
}

export const useChatStore = create<ChatState>((set) => {
  const armTypingExpiry = (userId: string, myEpoch: number) => {
    const prev = typingTimers.get(userId)
    if (prev) clearTimeout(prev)
    typingTimers.set(
      userId,
      setTimeout(() => {
        typingTimers.delete(userId)
        if (myEpoch !== epoch) return
        set((s) => {
          const typing = { ...s.typing }
          delete typing[userId]
          return { typing }
        })
      }, TYPING_TTL_MS),
    )
  }

  return {
    activeRoom: null,
    connected: false,
    messages: [],
    participants: [],
    typing: {},
    channels: [],
    dmPeers: [],

    openRoom: (roomKey, ticket, history) => {
      epoch += 1
      const myEpoch = epoch
      clearTypingTimers()
      if (ws) {
        try {
          ws.close()
        } catch {
          /* ignore */
        }
        ws = null
      }
      set({
        activeRoom: roomKey,
        messages: history,
        participants: [],
        typing: {},
        connected: false,
      })
      let retries = 0

      const openSocket = () => {
        if (myEpoch !== epoch) return
        const sock = new WebSocket(wsUrl(roomKey, ticket))
        ws = sock

        sock.onopen = () => {
          if (myEpoch !== epoch) return
          retries = 0
          set({ connected: true })
        }
        sock.onmessage = (ev) => {
          if (myEpoch !== epoch) return
          let msg: Record<string, unknown>
          try {
            msg = JSON.parse(ev.data)
          } catch {
            return
          }
          set((s) => applyFrame(msg, s))
          if (msg.type === 'typing') armTypingExpiry(msg.user_id as string, myEpoch)
        }
        sock.onclose = () => {
          if (myEpoch !== epoch) return
          set({ connected: false })
          if (retries < 5) {
            retries += 1
            setTimeout(openSocket, Math.min(500 * retries, 3000))
          }
        }
        sock.onerror = () => sock.close()
      }
      openSocket()
    },

    send: (text) => {
      if (ws?.readyState === WebSocket.OPEN && text.trim()) {
        ws.send(JSON.stringify({ type: 'chat', text }))
      }
    },

    sendTyping: () => {
      // Throttled so a burst of keystrokes is one frame; peers age it out at 4s.
      if (ws?.readyState === WebSocket.OPEN && Date.now() - lastTypingSentAt > 2500) {
        lastTypingSentAt = Date.now()
        ws.send(JSON.stringify({ type: 'typing' }))
      }
    },

    close: () => {
      epoch += 1
      clearTypingTimers()
      if (ws) {
        try {
          ws.close()
        } catch {
          /* ignore */
        }
        ws = null
      }
      set({ activeRoom: null, connected: false, participants: [], typing: {}, messages: [] })
    },

    loadChannels: async (workspaceId) => {
      set({ channels: await api.listChannels(workspaceId) })
    },
    loadDmPeers: async () => {
      set({ dmPeers: await api.dmPeers() })
    },
  }
})
