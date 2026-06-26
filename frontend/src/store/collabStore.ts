import { create } from 'zustand'

export interface Participant {
  conn_id: string
  user_id: string | null
  name: string
  color: string
}

export interface Comment {
  id: string
  dashboard_id: string
  widget_id: string | null
  author_id: string | null
  author_name: string
  content: string
  created_at: string
}

export interface RemoteCursor {
  conn_id: string
  name: string
  color: string
  x: number
  y: number
}

type Auth = { token?: string; share?: string }

interface CollabState {
  connected: boolean
  participants: Participant[]
  cursors: Record<string, RemoteCursor>
  messages: Comment[]
  connect: (dashboardId: string, auth: Auth, history: Comment[]) => void
  disconnect: () => void
  sendCursor: (x: number, y: number) => void
  sendChat: (text: string, widgetId?: string | null) => void
}

function wsUrl(dashboardId: string, auth: Auth): string {
  const api = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1'
  const base = api.replace(/^http/, 'ws').replace(/\/api\/v1\/?$/, '')
  const q = auth.token
    ? `token=${encodeURIComponent(auth.token)}`
    : `share=${encodeURIComponent(auth.share ?? '')}`
  return `${base}/ws/dashboard/${dashboardId}?${q}`
}

// Module-scoped socket so the store stays serialisable and only one is ever open.
let ws: WebSocket | null = null
let closing = false
let retries = 0

export const useCollabStore = create<CollabState>((set) => ({
  connected: false,
  participants: [],
  cursors: {},
  messages: [],

  connect: (dashboardId, auth, history) => {
    closing = false
    set({ messages: history, participants: [], cursors: {} })

    const open = () => {
      ws = new WebSocket(wsUrl(dashboardId, auth))

      ws.onopen = () => {
        retries = 0
        set({ connected: true })
      }
      ws.onmessage = (ev) => {
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
            set((s) => {
              const cursors = { ...s.cursors }
              delete cursors[msg.conn_id as string]
              return {
                participants: s.participants.filter((p) => p.conn_id !== msg.conn_id),
                cursors,
              }
            })
            break
          case 'cursor':
            set((s) => ({
              cursors: {
                ...s.cursors,
                [msg.conn_id as string]: {
                  conn_id: msg.conn_id as string,
                  name: msg.name as string,
                  color: msg.color as string,
                  x: msg.x as number,
                  y: msg.y as number,
                },
              },
            }))
            break
          case 'chat':
            set((s) => ({ messages: [...s.messages, msg.comment as Comment] }))
            break
        }
      }
      ws.onclose = () => {
        set({ connected: false })
        // Reconnect a few times unless we closed on purpose.
        if (!closing && retries < 5) {
          retries += 1
          setTimeout(open, Math.min(500 * retries, 3000))
        }
      }
      ws.onerror = () => ws?.close()
    }
    open()
  },

  disconnect: () => {
    closing = true
    ws?.close()
    ws = null
    set({ connected: false, participants: [], cursors: {}, messages: [] })
  },

  sendCursor: (x, y) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'cursor', x, y }))
  },

  sendChat: (text, widgetId) => {
    if (ws?.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'chat', text, widget_id: widgetId ?? null }))
  },
}))
