import { client } from './client'

export interface Workspace {
  id: string
  name: string
  owner_id: string
  role: string | null
  created_at: string
}

export interface WorkspaceMember {
  id: string
  user_id: string
  email: string
  role: string
}

export interface AuditEntry {
  id: string
  action: string
  entity: string
  entity_id: string | null
  meta: Record<string, unknown> | null
  created_at: string
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const { data } = await client.get<Workspace[]>('/workspaces')
  return data
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const { data } = await client.post<Workspace>('/workspaces', { name })
  return data
}

export async function deleteWorkspace(id: string): Promise<void> {
  await client.delete(`/workspaces/${id}`)
}

export async function listMembers(id: string): Promise<WorkspaceMember[]> {
  const { data } = await client.get<WorkspaceMember[]>(`/workspaces/${id}/members`)
  return data
}

export async function addMember(
  id: string,
  email: string,
  role: string,
): Promise<WorkspaceMember> {
  const { data } = await client.post<WorkspaceMember>(`/workspaces/${id}/members`, { email, role })
  return data
}

export async function removeMember(id: string, memberId: string): Promise<void> {
  await client.delete(`/workspaces/${id}/members/${memberId}`)
}

export async function renameWorkspace(id: string, name: string): Promise<Workspace> {
  const { data } = await client.patch<Workspace>(`/workspaces/${id}`, { name })
  return data
}

export async function changeMemberRole(
  id: string,
  memberId: string,
  role: string,
): Promise<WorkspaceMember> {
  const { data } = await client.patch<WorkspaceMember>(
    `/workspaces/${id}/members/${memberId}`,
    { role },
  )
  return data
}

export async function transferOwnership(id: string, memberId: string): Promise<void> {
  await client.post(`/workspaces/${id}/transfer`, { member_id: memberId })
}

export async function leaveWorkspace(id: string): Promise<void> {
  await client.post(`/workspaces/${id}/leave`)
}

export async function listAudit(): Promise<AuditEntry[]> {
  const { data } = await client.get<AuditEntry[]>('/audit')
  return data
}
