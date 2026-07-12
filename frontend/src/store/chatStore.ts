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

interface ChatState {
  activeRoom: string | null
  connected: boolean
  messages: ChatMessage[]
  participants: Participant[]
  channels: Channel[]
  dmPeers: DMPeer[]
  openRoom: (roomKey: string, ticket: string, history: ChatMessage[]) => void
  send: (text: string) => void
  close: () => void
  loadChannels: (workspaceId: string) => Promise<void>
  loadDmPeers: () => Promise<void>
}

export const useChatStore = create<ChatState>((set) => ({
  activeRoom: null,
  connected: false,
  messages: [],
  participants: [],
  channels: [],
  dmPeers: [],

  openRoom: (roomKey, ticket, history) => {
    epoch += 1
    const myEpoch = epoch
    if (ws) {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      ws = null
    }
    set({ activeRoom: roomKey, messages: history, participants: [], connected: false })
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
        switch (msg.type) {
          case 'presence':
            set({ participants: msg.participants as Participant[] })
            break
          case 'join':
            set((s) => ({ participants: [...s.participants, msg.participant as Participant] }))
            break
          case 'leave':
            set((s) => ({
              participants: s.participants.filter((p) => p.conn_id !== msg.conn_id),
            }))
            break
          case 'chat':
            set((s) => ({ messages: [...s.messages, msg.message as ChatMessage] }))
            break
        }
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

  close: () => {
    epoch += 1
    if (ws) {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      ws = null
    }
    set({ activeRoom: null, connected: false, participants: [], messages: [] })
  },

  loadChannels: async (workspaceId) => {
    set({ channels: await api.listChannels(workspaceId) })
  },
  loadDmPeers: async () => {
    set({ dmPeers: await api.dmPeers() })
  },
}))
