import { client } from './client'
import type { Alert, AlertCreate, AlertUpdate, AppNotification } from '../types'

export async function listAlerts(): Promise<Alert[]> {
  const { data } = await client.get<Alert[]>('/alerts')
  return data
}

export async function createAlert(payload: AlertCreate): Promise<Alert> {
  const { data } = await client.post<Alert>('/alerts', payload)
  return data
}

export async function updateAlert(id: string, payload: AlertUpdate): Promise<Alert> {
  const { data } = await client.patch<Alert>(`/alerts/${id}`, payload)
  return data
}

export async function removeAlert(id: string): Promise<void> {
  await client.delete(`/alerts/${id}`)
}

export async function listNotifications(): Promise<AppNotification[]> {
  // Background poll (TopBar, every 60s): stay silent so a transient/offline failure
  // never spams the global error toast; the store already swallows the rejection.
  const { data } = await client.get<AppNotification[]>('/notifications', { silent: true })
  return data
}

export async function readAll(): Promise<void> {
  await client.post('/notifications/read-all')
}

export async function readOne(id: string): Promise<void> {
  await client.post(`/notifications/${id}/read`)
}

export async function buildDigest(): Promise<{ created: number }> {
  const { data } = await client.post<{ created: number }>('/notifications/digest')
  return data
}
