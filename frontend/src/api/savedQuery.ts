import { client } from './client'
import type { QueryResult, SavedQuery, SavedQueryCreate, Schedule } from '../types'

export async function list(): Promise<SavedQuery[]> {
  const { data } = await client.get<SavedQuery[]>('/saved/')
  return data
}

export async function create(payload: SavedQueryCreate): Promise<SavedQuery> {
  const { data } = await client.post<SavedQuery>('/saved/', payload)
  return data
}

export async function update(
  id: string,
  patch: { name?: string; schedule?: Schedule },
): Promise<SavedQuery> {
  const { data } = await client.put<SavedQuery>(`/saved/${id}`, patch)
  return data
}

export async function remove(id: string): Promise<void> {
  await client.delete(`/saved/${id}`)
}

export async function run(id: string): Promise<QueryResult> {
  const { data } = await client.post<QueryResult>(`/saved/${id}/run`)
  return data
}
