import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { AppNotification } from '../types'
import * as api from '../api/alert'

interface NotificationState {
  items: AppNotification[]
  unread: number
  briefing: boolean
  load: () => Promise<void>
  /** A notification pushed down the per-user mailbox socket. */
  receive: (n: AppNotification) => void
  generateDigest: () => Promise<void>
  markAllRead: () => Promise<void>
  markOneRead: (id: string) => Promise<void>
}

// Track which notifications we've already shown so polling only toasts truly new ones.
// null = no baseline yet, so the first load is silent instead of a toast storm.
let known: Set<string> | null = null

/** Drop the toast baseline. Logout is a pure SPA transition — no reload — and this
 * is module state on a singleton store, so without resetting it the next user to
 * sign in on this tab inherits the previous user's "already seen" set. */
export function resetNotificationBaseline() {
  known = null
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unread: 0,
  briefing: false,
  load: async () => {
    const items = await api.listNotifications()
    // No toasting here any more: notifications arrive over the mailbox socket and
    // announce themselves the moment they are created. This is a plain reconcile.
    known = new Set(items.map((n) => n.id))
    set({ items, unread: items.filter((n) => !n.read).length })
  },

  receive: (n) => {
    // A reconnect resends nothing, but load() can race a push either way round.
    if (known?.has(n.id) || get().items.some((x) => x.id === n.id)) return
    known?.add(n.id)
    set({ items: [n, ...get().items], unread: get().unread + 1 })
    // Briefs announce themselves via generateDigest, and a chat mention already
    // toasts as a chat message — without both exclusions one @mention fires twice.
    if (n.category !== 'digest' && n.category !== 'mention') toast(n.title)
  },
  generateDigest: async () => {
    if (get().briefing) return
    set({ briefing: true })
    try {
      const { created } = await api.buildDigest()
      await get().load()
      if (!created) toast('Brif üçün kifayət qədər data yoxdur.')
      else toast('Səhər brifi hazırdır')
    } catch {
      /* interceptor toast */
    } finally {
      set({ briefing: false })
    }
  },
  markAllRead: async () => {
    await api.readAll()
    set({ items: get().items.map((n) => ({ ...n, read: true })), unread: 0 })
  },
  markOneRead: async (id) => {
    const target = get().items.find((n) => n.id === id)
    if (!target || target.read) return
    set({
      items: get().items.map((n) => (n.id === id ? { ...n, read: true } : n)),
      unread: Math.max(0, get().unread - 1),
    })
    try {
      await api.readOne(id)
    } catch {
      /* interceptor toast; optimistic state stays — next load() reconciles */
    }
  },
}))
