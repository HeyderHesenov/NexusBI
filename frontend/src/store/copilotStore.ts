import { create } from 'zustand'
import * as copilotApi from '../api/copilot'
import type { CopilotAction, CopilotPlanStep } from '../api/copilot'

export interface CopilotMessage {
  role: 'user' | 'assistant'
  content: string
  actions?: CopilotAction[]
  plan?: CopilotPlanStep[]
  /** When set, this assistant message is a plan awaiting approval (carries the
   *  original user request to execute). Cleared once approved or cancelled. */
  pendingMessage?: string
  approving?: boolean
}

interface CopilotState {
  open: boolean
  sending: boolean
  thread: CopilotMessage[]
  toggle: () => void
  setOpen: (open: boolean) => void
  send: (text: string) => Promise<void>
  approve: (index: number) => Promise<void>
  cancel: (index: number) => void
  reset: () => void
}

// History sent to the server: plain role/content of resolved turns only.
const toHistory = (thread: CopilotMessage[]) =>
  thread
    .filter((m) => !m.pendingMessage)
    .map((m) => ({ role: m.role, content: m.content }))

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
    // One plan at a time — don't start a new turn while one awaits approval.
    if (get().thread.some((m) => m.pendingMessage)) return
    const history = toHistory(get().thread)
    set((s) => ({ thread: [...s.thread, { role: 'user', content: message }], sending: true }))
    try {
      const res = await copilotApi.copilotChat(message, history, 'plan')
      set((s) => ({
        thread: [
          ...s.thread,
          { role: 'assistant', content: res.reply, plan: res.plan, pendingMessage: message },
        ],
      }))
    } catch {
      set((s) => ({
        thread: [
          ...s.thread,
          { role: 'assistant', content: 'Bağışla, indi plan qura bilmədim. Yenidən cəhd et.' },
        ],
      }))
    } finally {
      set({ sending: false })
    }
  },

  approve: async (index) => {
    const msg = get().thread[index]
    if (!msg?.pendingMessage || get().sending) return
    const message = msg.pendingMessage
    const plan = msg.plan ?? []
    // History up to (not including) the user turn that produced this plan — the
    // request itself is re-sent as `message`, so excluding it avoids duplication.
    const history = toHistory(get().thread.slice(0, Math.max(0, index - 1)))
    set((s) => ({
      thread: s.thread.map((m, i) => (i === index ? { ...m, approving: true } : m)),
      sending: true,
    }))
    try {
      const res = await copilotApi.copilotChat(message, history, 'execute', plan)
      set((s) => ({
        thread: [
          ...s.thread.map((m, i) =>
            i === index ? { ...m, pendingMessage: undefined, approving: false } : m,
          ),
          { role: 'assistant', content: res.reply, actions: res.actions },
        ],
      }))
    } catch {
      set((s) => ({
        thread: s.thread.map((m, i) =>
          i === index ? { ...m, approving: false } : m,
        ),
      }))
    } finally {
      set({ sending: false })
    }
  },

  cancel: (index) => {
    if (get().sending) return // don't cancel a plan whose execution is in flight
    set((s) => ({
      thread: s.thread.map((m, i) =>
        i === index ? { ...m, pendingMessage: undefined, content: 'Plan ləğv edildi.' } : m,
      ),
    }))
  },
}))
