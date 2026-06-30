import { client } from './client'
import type { Experiment, ExperimentCreate } from '../types'

export async function list(): Promise<Experiment[]> {
  const { data } = await client.get<Experiment[]>('/experiments/')
  return data
}

export async function create(payload: ExperimentCreate): Promise<Experiment> {
  const { data } = await client.post<Experiment>('/experiments/', payload)
  return data
}

export async function analyze(id: string): Promise<Experiment> {
  const { data } = await client.post<Experiment>(`/experiments/${id}/analyze`)
  return data
}

export async function remove(id: string): Promise<void> {
  await client.delete(`/experiments/${id}`)
}
