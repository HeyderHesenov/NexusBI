import { client } from './client'
import type { Insight } from '../types'

export async function list(): Promise<Insight[]> {
  const { data } = await client.get<Insight[]>('/insights/')
  return data
}

export async function generate(): Promise<{ created: number }> {
  const { data } = await client.post<{ created: number }>('/insights/generate')
  return data
}

export async function dismiss(id: string): Promise<void> {
  await client.post(`/insights/${id}/dismiss`)
}
