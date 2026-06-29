import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/copilot', () => ({ copilotChat: vi.fn() }))

import { useCopilotStore } from './copilotStore'
import * as copilotApi from '../api/copilot'

const mockChat = vi.mocked(copilotApi.copilotChat)

beforeEach(() => {
  mockChat.mockReset()
  useCopilotStore.setState({ open: false, sending: false, thread: [] })
})

describe('copilotStore — pure state', () => {
  it('toggle flips open', () => {
    useCopilotStore.getState().toggle()
    expect(useCopilotStore.getState().open).toBe(true)
    useCopilotStore.getState().toggle()
    expect(useCopilotStore.getState().open).toBe(false)
  })

  it('setOpen and reset', () => {
    useCopilotStore.getState().setOpen(true)
    expect(useCopilotStore.getState().open).toBe(true)
    useCopilotStore.setState({ thread: [{ role: 'user', content: 'x' }] })
    useCopilotStore.getState().reset()
    expect(useCopilotStore.getState().thread).toEqual([])
  })

  it('cancel clears a pending plan in place', () => {
    useCopilotStore.setState({
      thread: [{ role: 'assistant', content: 'plan', pendingMessage: 'do it' }],
    })
    useCopilotStore.getState().cancel(0)
    const m = useCopilotStore.getState().thread[0]
    expect(m.pendingMessage).toBeUndefined()
    expect(m.content).toBe('Plan ləğv edildi.')
  })

  it('cancel is a no-op while sending', () => {
    useCopilotStore.setState({
      sending: true,
      thread: [{ role: 'assistant', content: 'plan', pendingMessage: 'do it' }],
    })
    useCopilotStore.getState().cancel(0)
    expect(useCopilotStore.getState().thread[0].pendingMessage).toBe('do it')
  })
})

describe('copilotStore.send guards', () => {
  it('ignores empty input', async () => {
    await useCopilotStore.getState().send('   ')
    expect(mockChat).not.toHaveBeenCalled()
    expect(useCopilotStore.getState().thread).toEqual([])
  })

  it('appends a pending plan turn on success', async () => {
    mockChat.mockResolvedValue({ reply: 'here is the plan', plan: [], actions: [] } as never)
    await useCopilotStore.getState().send('build a dashboard')
    const thread = useCopilotStore.getState().thread
    expect(thread[0]).toMatchObject({ role: 'user', content: 'build a dashboard' })
    expect(thread[1]).toMatchObject({ role: 'assistant', pendingMessage: 'build a dashboard' })
    expect(useCopilotStore.getState().sending).toBe(false)
  })

  it('refuses a new turn while a plan awaits approval', async () => {
    useCopilotStore.setState({
      thread: [{ role: 'assistant', content: 'plan', pendingMessage: 'first' }],
    })
    await useCopilotStore.getState().send('second')
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('surfaces a fallback message when the plan call fails', async () => {
    mockChat.mockRejectedValue(new Error('boom'))
    await useCopilotStore.getState().send('x')
    const t = useCopilotStore.getState().thread
    const lastMsg = t[t.length - 1]
    expect(lastMsg?.role).toBe('assistant')
    expect(lastMsg?.pendingMessage).toBeUndefined()
    expect(useCopilotStore.getState().sending).toBe(false)
  })
})
