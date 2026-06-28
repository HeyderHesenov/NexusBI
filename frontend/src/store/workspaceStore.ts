import { create } from 'zustand'
import toast from 'react-hot-toast'
import * as api from '../api/workspace'
import type { AuditEntry, Workspace, WorkspaceMember } from '../api/workspace'

interface WorkspaceState {
  workspaces: Workspace[]
  members: Record<string, WorkspaceMember[]>
  audit: AuditEntry[]
  load: () => Promise<void>
  create: (name: string) => Promise<void>
  loadMembers: (id: string) => Promise<void>
  addMember: (id: string, email: string, role: string) => Promise<void>
  removeMember: (id: string, memberId: string) => Promise<void>
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
  loadAudit: async () => set({ audit: await api.listAudit() }),
}))
