import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('../api/snapshot', () => ({ list: vi.fn(), capture: vi.fn(), get: vi.fn(), remove: vi.fn() }))

import { useSnapshotStore } from './snapshotStore'
import * as api from '../api/snapshot'
import type { SnapshotFull, SnapshotMeta } from '../types'

const meta = (id: string): SnapshotMeta => ({
  id, label: '', origin: 'manual', created_at: '2026-07-02T10:00:00Z',
})
const full = (id: string): SnapshotFull => ({
  id, label: '', origin: 'manual', created_at: '2026-07-02T10:00:00Z', widgets: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  useSnapshotStore.getState().reset()
})

describe('snapshotStore', () => {
  it('capture reloads the timeline', async () => {
    vi.mocked(api.capture).mockResolvedValue(meta('s1'))
    vi.mocked(api.list).mockResolvedValue([meta('s1')])
    await useSnapshotStore.getState().capture('d1')
    expect(api.capture).toHaveBeenCalledWith('d1', '')
    expect(useSnapshotStore.getState().items.map((s) => s.id)).toEqual(['s1'])
    expect(useSnapshotStore.getState().capturing).toBe(false)
  })

  it('select loads the full snapshot; clearSelection drops it', async () => {
    useSnapshotStore.setState({ dashboardId: 'd1' })
    vi.mocked(api.get).mockResolvedValue(full('s2'))
    await useSnapshotStore.getState().select('d1', 's2')
    expect(useSnapshotStore.getState().selected?.id).toBe('s2')
    useSnapshotStore.getState().clearSelection()
    expect(useSnapshotStore.getState().selected).toBeNull()
  })

  it('removing the selected snapshot also clears the selection', async () => {
    useSnapshotStore.setState({ selected: full('s3'), items: [meta('s3')] })
    vi.mocked(api.remove).mockResolvedValue(undefined)
    vi.mocked(api.list).mockResolvedValue([])
    await useSnapshotStore.getState().remove('d1', 's3')
    expect(useSnapshotStore.getState().selected).toBeNull()
    expect(useSnapshotStore.getState().items).toEqual([])
  })

  it('removing a non-selected snapshot keeps the selection', async () => {
    useSnapshotStore.setState({ selected: full('keep'), items: [meta('keep'), meta('drop')], dashboardId: 'd1' })
    vi.mocked(api.remove).mockResolvedValue(undefined)
    vi.mocked(api.list).mockResolvedValue([meta('keep')])
    await useSnapshotStore.getState().remove('d1', 'drop')
    expect(useSnapshotStore.getState().selected?.id).toBe('keep')
  })

  it('a stale in-flight select is discarded after a dashboard switch', async () => {
    useSnapshotStore.setState({ dashboardId: 'dA' })
    let resolve: (v: SnapshotFull) => void = () => {}
    vi.mocked(api.get).mockReturnValue(new Promise((r) => { resolve = r }))
    const pending = useSnapshotStore.getState().select('dA', 's1')
    useSnapshotStore.getState().reset() // user switched dashboards
    useSnapshotStore.setState({ dashboardId: 'dB' })
    resolve(full('s1'))
    await pending
    expect(useSnapshotStore.getState().selected).toBeNull() // dA's snapshot dropped
  })

  it('a stale in-flight load does not leak another dashboard items', async () => {
    let resolve: (v: SnapshotMeta[]) => void = () => {}
    vi.mocked(api.list).mockReturnValueOnce(new Promise((r) => { resolve = r }))
    const pending = useSnapshotStore.getState().load('dA')
    useSnapshotStore.getState().reset()
    useSnapshotStore.setState({ dashboardId: 'dB' })
    resolve([meta('a1')])
    await pending
    expect(useSnapshotStore.getState().items).toEqual([])
  })
})
