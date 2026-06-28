import { client } from './client'
import type { Alert, AlertCreate, AppNotification } from '../types'

export async function listAlerts(): Promise<Alert[]> {
  const { data } = await client.get<Alert[]>('/alerts')
  return data
}

export async function createAlert(payload: AlertCreate): Promise<Alert> {
  const { data } = await client.post<Alert>('/alerts', payload)
  return data
}

export async function removeAlert(id: string): Promise<void> {
  await client.delete(`/alerts/${id}`)
}

export async function listNotifications(): Promise<AppNotification[]> {
  const { data } = await client.get<AppNotification[]>('/notifications')
  return data
}

export async function readAll(): Promise<void> {
  await client.post('/notifications/read-all')
}

export async function readOne(id: string): Promise<void> {
  await client.post(`/notifications/${id}/read`)
}

export async function generateInsights(): Promise<{ created: number }> {
  const { data } = await client.post<{ created: number }>('/notifications/generate-insights')
  return data
}

export async function buildDigest(): Promise<{ created: number }> {
  const { data } = await client.post<{ created: number }>('/notifications/digest')
  return data
}
