import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }))
vi.mock('../api/workspace', () => ({
  listWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  listMembers: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  renameWorkspace: vi.fn(),
  changeMemberRole: vi.fn(),
  transferOwnership: vi.fn(),
  leaveWorkspace: vi.fn(),
  listAudit: vi.fn(),
}))

import { useWorkspaceStore } from './workspaceStore'
import * as api from '../api/workspace'

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState({ workspaces: [], members: {}, audit: [] })
})

describe('workspaceStore', () => {
  it('changeRole calls the api and reloads that workspace’s members', async () => {
    vi.mocked(api.changeMemberRole).mockResolvedValue({ id: 'm1', user_id: 'u1', email: 'a@b.c', role: 'editor' })
    vi.mocked(api.listMembers).mockResolvedValue([{ id: 'm1', user_id: 'u1', email: 'a@b.c', role: 'editor' }])

    await useWorkspaceStore.getState().changeRole('w1', 'm1', 'editor')

    expect(api.changeMemberRole).toHaveBeenCalledWith('w1', 'm1', 'editor')
    expect(api.listMembers).toHaveBeenCalledWith('w1')
    expect(useWorkspaceStore.getState().members['w1'][0].role).toBe('editor')
  })

  it('transfer calls the api and refreshes workspaces + members + audit', async () => {
    vi.mocked(api.transferOwnership).mockResolvedValue(undefined)
    vi.mocked(api.listWorkspaces).mockResolvedValue([])
    vi.mocked(api.listMembers).mockResolvedValue([])
    vi.mocked(api.listAudit).mockResolvedValue([])

    await useWorkspaceStore.getState().transfer('w1', 'm1')

    expect(api.transferOwnership).toHaveBeenCalledWith('w1', 'm1')
    expect(api.listWorkspaces).toHaveBeenCalled()
    expect(api.listMembers).toHaveBeenCalledWith('w1')
    expect(api.listAudit).toHaveBeenCalled()
  })

  it('leave prunes the workspace optimistically', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'w1', name: 'x', owner_id: 'o', role: 'viewer', created_at: '' }],
      members: { w1: [] },
      audit: [],
    })
    vi.mocked(api.leaveWorkspace).mockResolvedValue(undefined)
    vi.mocked(api.listAudit).mockResolvedValue([])

    await useWorkspaceStore.getState().leave('w1')

    expect(api.leaveWorkspace).toHaveBeenCalledWith('w1')
    expect(useWorkspaceStore.getState().workspaces).toEqual([])
  })

  it('rename calls the api then reloads workspaces + audit', async () => {
    vi.mocked(api.renameWorkspace).mockResolvedValue({ id: 'w1', name: 'Yeni', owner_id: 'o', role: 'owner', created_at: '' })
    vi.mocked(api.listWorkspaces).mockResolvedValue([{ id: 'w1', name: 'Yeni', owner_id: 'o', role: 'owner', created_at: '' }])
    vi.mocked(api.listAudit).mockResolvedValue([])

    await useWorkspaceStore.getState().rename('w1', 'Yeni')

    expect(api.renameWorkspace).toHaveBeenCalledWith('w1', 'Yeni')
    expect(useWorkspaceStore.getState().workspaces[0].name).toBe('Yeni')
  })
})
