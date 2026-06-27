import { create } from 'zustand'
import * as copilotApi from '../api/copilot'
import type { CopilotAction } from '../api/copilot'

export interface CopilotMessage {
  role: 'user' | 'assistant'
  content: string
  actions?: CopilotAction[]
}

interface CopilotState {
  open: boolean
  sending: boolean
  thread: CopilotMessage[]
  toggle: () => void
  setOpen: (open: boolean) => void
  send: (text: string) => Promise<void>
  reset: () => void
}

export const useCopilotStore = create<CopilotState>((set, get) => ({
  open: false,
  sending: false,
  thread: [],
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  reset: () => set({ thread: [] }),
  send: async (text) => {
    const message = text.trim()
    if (!message || get().sending) return
    // Send prior turns as plain role/content; the server replays no tool plumbing.
    const history = get().thread.map((m) => ({ role: m.role, content: m.content }))
    set((s) => ({ thread: [...s.thread, { role: 'user', content: message }], sending: true }))
    try {
      const res = await copilotApi.copilotChat(message, history)
      set((s) => ({
        thread: [...s.thread, { role: 'assistant', content: res.reply, actions: res.actions }],
      }))
    } catch {
      set((s) => ({
        thread: [
          ...s.thread,
          { role: 'assistant', content: 'Bağışla, indi cavab verə bilmədim. Yenidən cəhd et.' },
        ],
      }))
    } finally {
      set({ sending: false })
    }
  },
}))
