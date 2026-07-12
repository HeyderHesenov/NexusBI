import { create } from 'zustand'
import toast from 'react-hot-toast'
import i18n from '../i18n'
import * as api from '../api/workspace'
import type { AuditEntry, Workspace, WorkspaceMember } from '../api/workspace'

interface WorkspaceState {
  workspaces: Workspace[]
  members: Record<string, WorkspaceMember[]>
  audit: AuditEntry[]
  load: () => Promise<void>
  create: (name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  loadMembers: (id: string) => Promise<void>
  addMember: (id: string, email: string, role: string) => Promise<void>
  removeMember: (id: string, memberId: string) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
  changeRole: (id: string, memberId: string, role: string) => Promise<void>
  transfer: (id: string, memberId: string) => Promise<void>
  leave: (id: string) => Promise<void>
  loadAudit: () => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  members: {},
  audit: [],
  load: async () => set({ workspaces: await api.listWorkspaces() }),
  create: async (name) => {
    await api.createWorkspace(name)
    await get().load()
    toast.success('İş sahəsi yaradıldı.')
  },
  remove: async (id) => {
    await api.deleteWorkspace(id)
    set((s) => {
      const members = { ...s.members }
      delete members[id]
      return { workspaces: s.workspaces.filter((w) => w.id !== id), members }
    })
    await get().loadAudit()
    toast.success('İş sahəsi silindi.')
  },
  loadMembers: async (id) => {
    const members = await api.listMembers(id)
    set((s) => ({ members: { ...s.members, [id]: members } }))
  },
  addMember: async (id, email, role) => {
    try {
      await api.addMember(id, email, role)
      await get().loadMembers(id)
      toast.success('Üzv əlavə olundu.')
    } catch {
      /* interceptor toast */
    }
  },
  removeMember: async (id, memberId) => {
    await api.removeMember(id, memberId)
    await get().loadMembers(id)
  },
  rename: async (id, name) => {
    await api.renameWorkspace(id, name)
    await get().load()
    await get().loadAudit()
    toast.success(i18n.t('workspacePage.renamed'))
  },
  changeRole: async (id, memberId, role) => {
    try {
      await api.changeMemberRole(id, memberId, role)
      await get().loadMembers(id)
      toast.success(i18n.t('workspacePage.roleUpdated'))
    } catch {
      /* interceptor toast */
    }
  },
  transfer: async (id, memberId) => {
    await api.transferOwnership(id, memberId)
    await get().load()
    await get().loadMembers(id)
    await get().loadAudit()
    toast.success(i18n.t('workspacePage.transferred'))
  },
  leave: async (id) => {
    await api.leaveWorkspace(id)
    set((s) => {
      const members = { ...s.members }
      delete members[id]
      return { workspaces: s.workspaces.filter((w) => w.id !== id), members }
    })
    await get().loadAudit()
    toast.success(i18n.t('workspacePage.left'))
  },
  loadAudit: async () => set({ audit: await api.listAudit() }),
}))
