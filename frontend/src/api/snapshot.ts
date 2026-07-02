import { client } from './client'
import type { SnapshotFull, SnapshotMeta } from '../types'

export async function list(dashboardId: string): Promise<SnapshotMeta[]> {
  const { data } = await client.get<SnapshotMeta[]>(`/dashboard/${dashboardId}/snapshots`)
  return data
}

export async function capture(dashboardId: string, label = ''): Promise<SnapshotMeta> {
  const { data } = await client.post<SnapshotMeta>(`/dashboard/${dashboardId}/snapshots`, { label })
  return data
}

export async function get(dashboardId: string, snapshotId: string): Promise<SnapshotFull> {
  const { data } = await client.get<SnapshotFull>(
    `/dashboard/${dashboardId}/snapshots/${snapshotId}`,
  )
  return data
}

export async function remove(dashboardId: string, snapshotId: string): Promise<void> {
  await client.delete(`/dashboard/${dashboardId}/snapshots/${snapshotId}`)
}
