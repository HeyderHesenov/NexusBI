import { create } from 'zustand'
import type { AppNotification } from '../types'
import * as api from '../api/alert'

interface NotificationState {
  items: AppNotification[]
  unread: number
  load: () => Promise<void>
  markAllRead: () => Promise<void>
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unread: 0,
  load: async () => {
    const items = await api.listNotifications()
    set({ items, unread: items.filter((n) => !n.read).length })
  },
  markAllRead: async () => {
    await api.readAll()
    set({ items: get().items.map((n) => ({ ...n, read: true })), unread: 0 })
  },
}))
