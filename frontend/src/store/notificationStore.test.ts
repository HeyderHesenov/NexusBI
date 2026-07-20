import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: vi.fn() }))
vi.mock('../api/alert', () => ({
  listNotifications: vi.fn(),
  buildDigest: vi.fn(),
  readAll: vi.fn(),
  readOne: vi.fn(),
}))

type Store = typeof import('./notificationStore')['useNotificationStore']
let useNotificationStore: Store
let list: ReturnType<typeof vi.fn>
let readAll: ReturnType<typeof vi.fn>
let readOne: ReturnType<typeof vi.fn>
let mockToast: ReturnType<typeof vi.fn>

const note = (id: string, read = false, category = 'insight') =>
  ({ id, read, category, title: 't', body: 'b' }) as never

// resetModules each test so the store's module-level `known` Set starts fresh —
// otherwise the "first poll is silent" baseline leaks across tests.
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  ;({ useNotificationStore } = await import('./notificationStore'))
  const api = await import('../api/alert')
  list = vi.mocked(api.listNotifications)
  readAll = vi.mocked(api.readAll)
  readOne = vi.mocked(api.readOne)
  mockToast = vi.mocked((await import('react-hot-toast')).default)
})

describe('notificationStore.load', () => {
  it('sets items and counts unread', async () => {
    list.mockResolvedValue([note('a', false), note('b', true)] as never)
    await useNotificationStore.getState().load()
    expect(useNotificationStore.getState().items).toHaveLength(2)
    expect(useNotificationStore.getState().unread).toBe(1)
  })

  it('never toasts — it is a reconcile now; the mailbox socket does the announcing', async () => {
    list.mockResolvedValue([note('a', false)] as never)
    await useNotificationStore.getState().load()
    list.mockResolvedValue([note('a', false), note('b', false)] as never)
    await useNotificationStore.getState().load()
    expect(mockToast).not.toHaveBeenCalled()
  })
})

describe('notificationStore.receive', () => {
  it('prepends a pushed notification, bumps unread, and toasts it', () => {
    useNotificationStore.getState().receive(note('new'))
    const s = useNotificationStore.getState()
    expect(s.items[0].id).toBe('new')
    expect(s.unread).toBe(1)
    expect(mockToast).toHaveBeenCalledTimes(1)
  })

  it('ignores a notification load() already has, so a race cannot double-count', async () => {
    list.mockResolvedValue([note('a', false)] as never)
    await useNotificationStore.getState().load()
    useNotificationStore.getState().receive(note('a'))
    expect(useNotificationStore.getState().items).toHaveLength(1)
    expect(useNotificationStore.getState().unread).toBe(1)
  })

  it('does not toast a digest — generateDigest already announces it', () => {
    useNotificationStore.getState().receive(note('brief', false, 'digest'))
    expect(useNotificationStore.getState().unread).toBe(1)
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('does not toast a chat mention — it already toasted as a chat message', () => {
    useNotificationStore.getState().receive(note('m', false, 'mention'))
    expect(useNotificationStore.getState().unread).toBe(1)
    expect(mockToast).not.toHaveBeenCalled()
  })
})

describe('notificationStore.markAllRead', () => {
  it('marks every item read and zeroes the counter', async () => {
    readAll.mockResolvedValue(undefined as never)
    useNotificationStore.setState({ items: [note('a', false), note('b', false)] as never, unread: 2 })
    await useNotificationStore.getState().markAllRead()
    const s = useNotificationStore.getState()
    expect(s.unread).toBe(0)
    expect(s.items.every((n) => n.read)).toBe(true)
  })
})

describe('notificationStore.markOneRead', () => {
  it('marks a single item read, decrements unread, and calls the API', async () => {
    readOne.mockResolvedValue(undefined as never)
    useNotificationStore.setState({ items: [note('a', false), note('b', false)] as never, unread: 2 })
    await useNotificationStore.getState().markOneRead('a')
    const s = useNotificationStore.getState()
    expect(s.unread).toBe(1)
    expect(s.items.find((n) => n.id === 'a')?.read).toBe(true)
    expect(s.items.find((n) => n.id === 'b')?.read).toBe(false)
    expect(readOne).toHaveBeenCalledWith('a')
  })

  it('is a no-op for an already-read item (no API call, counter unchanged)', async () => {
    readOne.mockResolvedValue(undefined as never)
    useNotificationStore.setState({ items: [note('a', true)] as never, unread: 0 })
    await useNotificationStore.getState().markOneRead('a')
    expect(useNotificationStore.getState().unread).toBe(0)
    expect(readOne).not.toHaveBeenCalled()
  })
})
