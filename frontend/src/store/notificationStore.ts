import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { AppNotification } from '../types'
import * as api from '../api/alert'

interface NotificationState {
  items: AppNotification[]
  unread: number
  generating: boolean
  load: () => Promise<void>
  generate: () => Promise<void>
  markAllRead: () => Promise<void>
}

// Track which notifications we've already shown so polling only toasts truly new ones.
let known: Set<string> | null = null

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unread: 0,
  generating: false,
  load: async () => {
    const items = await api.listNotifications()
    if (known !== null) {
      const fresh = items.filter((n) => !n.read && !known!.has(n.id)).length
      if (fresh > 0) toast(`${fresh} yeni smart insight ✨`, { icon: '🔔' })
    }
    known = new Set(items.map((n) => n.id))
    set({ items, unread: items.filter((n) => !n.read).length })
  },
  generate: async () => {
    if (get().generating) return
    set({ generating: true })
    try {
      const { created } = await api.generateInsights()
      // load() already toasts the freshly created insights; only speak up here
      // when nothing notable was found (load() stays silent in that case).
      await get().load()
      if (!created) toast('Yeni insight tapılmadı.', { icon: 'ℹ️' })
    } catch {
      /* interceptor toast */
    } finally {
      set({ generating: false })
    }
  },
  markAllRead: async () => {
    await api.readAll()
    set({ items: get().items.map((n) => ({ ...n, read: true })), unread: 0 })
  },
}))
