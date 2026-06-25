import { client } from './client'
import type { Decision, DecisionCreate, DecisionStatus } from '../types'

export async function list(): Promise<Decision[]> {
  const { data } = await client.get<Decision[]>('/decisions/')
  return data
}

export async function create(payload: DecisionCreate): Promise<Decision> {
  const { data } = await client.post<Decision>('/decisions/', payload)
  return data
}

export async function update(
  id: string,
  patch: { title?: string; action?: string; status?: DecisionStatus; outcome?: string },
): Promise<Decision> {
  const { data } = await client.put<Decision>(`/decisions/${id}`, patch)
  return data
}

export async function remove(id: string): Promise<void> {
  await client.delete(`/decisions/${id}`)
}
