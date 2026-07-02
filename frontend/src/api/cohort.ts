import { client } from './client'
import type { CohortData, FunnelStep } from '../types'

export async function retention(): Promise<CohortData> {
  const { data } = await client.get<CohortData>('/cohort/retention')
  return data
}

export async function funnel(): Promise<FunnelStep[]> {
  const { data } = await client.get<{ steps: FunnelStep[] }>('/cohort/funnel')
  return data.steps
}
