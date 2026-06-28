import { client } from './client'
import type { Dashboard, RequirementDoc } from '../types'

export async function extractRequirements(name: string, text: string): Promise<RequirementDoc> {
  const { data } = await client.post<RequirementDoc>('/requirements/extract', { name, text })
  return data
}

export async function listRequirements(): Promise<RequirementDoc[]> {
  const { data } = await client.get<RequirementDoc[]>('/requirements')
  return data
}

export async function buildFromRequirement(
  id: string,
  datasourceId: string | null,
  questions: string[],
): Promise<Dashboard> {
  const { data } = await client.post<Dashboard>(`/requirements/${id}/build`, {
    datasource_id: datasourceId,
    questions,
  })
  return data
}
