import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { AppNotification } from '../types'
import * as api from '../api/alert'

interface NotificationState {
  items: AppNotification[]
  unread: number
  briefing: boolean
  load: () => Promise<void>
  generateDigest: () => Promise<void>
  markAllRead: () => Promise<void>
  markOneRead: (id: string) => Promise<void>
}

// Track which notifications we've already shown so polling only toasts truly new ones.
let known: Set<string> | null = null

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unread: 0,
  briefing: false,
  load: async () => {
    const items = await api.listNotifications()
    if (known !== null) {
      // Briefs announce themselves via generateDigest; don't double-toast them here.
      const fresh = items.filter(
        (n) => !n.read && !known!.has(n.id) && n.category !== 'digest',
      ).length
      if (fresh > 0) toast(`${fresh} yeni bildiriş 🔔`, { icon: '🔔' })
    }
    known = new Set(items.map((n) => n.id))
    set({ items, unread: items.filter((n) => !n.read).length })
  },
  generateDigest: async () => {
    if (get().briefing) return
    set({ briefing: true })
    try {
      const { created } = await api.buildDigest()
      await get().load()
      if (!created) toast('Brif üçün kifayət qədər data yoxdur.', { icon: 'ℹ️' })
      else toast('Səhər brifi hazırdır 🌅', { icon: '✨' })
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
