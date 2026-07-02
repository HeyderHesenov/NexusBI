import { client } from './client'
import type { BAArtifact, BAFramework } from '../types'

export async function generate(payload: {
  framework: BAFramework
  title?: string
  context: string
}): Promise<BAArtifact> {
  const { data } = await client.post<BAArtifact>('/ba/generate', payload)
  return data
}

export async function list(): Promise<BAArtifact[]> {
  const { data } = await client.get<BAArtifact[]>('/ba')
  return data
}

export async function remove(id: string): Promise<void> {
  await client.delete(`/ba/${id}`)
}
