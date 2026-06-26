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
// `epoch` invalidates a previous connection: any stale socket whose captured
// epoch no longer matches must not reconnect or mutate state. This makes
// switching dashboards (and React StrictMode's double-invoke) race-free.
let ws: WebSocket | null = null
let epoch = 0

export const useCollabStore = create<CollabState>((set) => ({
  connected: false,
  participants: [],
  cursors: {},
  messages: [],

  connect: (dashboardId, auth, history) => {
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
    set({ messages: history, participants: [], cursors: {}, connected: false })
    let retries = 0

    const open = () => {
      if (myEpoch !== epoch) return
      const sock = new WebSocket(wsUrl(dashboardId, auth))
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
      sock.onclose = () => {
        if (myEpoch !== epoch) return
        set({ connected: false })
        // Reconnect a few times unless this connection has been superseded.
        if (retries < 5) {
          retries += 1
          setTimeout(open, Math.min(500 * retries, 3000))
        }
      }
      sock.onerror = () => sock.close()
    }
    open()
  },

  disconnect: () => {
    epoch += 1 // invalidate the active connection so it won't reconnect
    if (ws) {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      ws = null
    }
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
