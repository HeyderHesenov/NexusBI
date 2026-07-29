import { client } from './client'
import type { BAArtifact, BAFramework, Decision } from '../types'

export interface BAPromoteResult {
  decision: Decision
  /** The artifact with the action now citing its decision — replace, don't patch. */
  artifact: BAArtifact
}

export async function generate(payload: {
  framework: BAFramework
  title?: string
  context: string
  datasource_id?: string | null
}): Promise<BAArtifact> {
  const { data } = await client.post<BAArtifact>('/ba/generate', payload)
  return data
}

/** Turn one prioritised action into a tracked decision. Idempotent per action. */
export async function promote(id: string, actionIndex: number): Promise<BAPromoteResult> {
  const { data } = await client.post<BAPromoteResult>(`/ba/${id}/promote`, {
    action_index: actionIndex,
  })
  return data
}

export async function list(): Promise<BAArtifact[]> {
  const { data } = await client.get<BAArtifact[]>('/ba')
  return data
}

export async function remove(id: string): Promise<void> {
  await client.delete(`/ba/${id}`)
}
