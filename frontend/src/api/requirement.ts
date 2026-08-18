import { client } from './client'
import type { Dashboard, Decision, DecisionDirection, RequirementDoc } from '../types'

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

export interface PromoteKpiBody {
  kpi_index: number
  target_value: number
  direction: DecisionDirection | null
  datasource_id: string | null
}

export async function getRequirement(id: string): Promise<RequirementDoc> {
  const { data } = await client.get<RequirementDoc>(`/requirements/${id}`)
  return data
}

export async function promoteKpi(
  docId: string,
  body: PromoteKpiBody,
): Promise<{ decision: Decision; requirement: RequirementDoc }> {
  const { data } = await client.post<{ decision: Decision; requirement: RequirementDoc }>(
    `/requirements/${docId}/promote`,
    body,
  )
  return data
}
