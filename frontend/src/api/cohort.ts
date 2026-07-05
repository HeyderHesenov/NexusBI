import { client } from './client'
import type { CohortData, FunnelStep } from '../types'

/** Column mapping for real-data cohort analysis. Omit (or leave partial) to
 * run against the demo snapshot. */
export interface CohortQuery {
  datasource_id?: string | null
  table?: string | null
  entity_col?: string | null
  date_col?: string | null
  stage_col?: string | null
}

export async function retention(cfg: CohortQuery = {}): Promise<CohortData> {
  const { data } = await client.post<CohortData>('/cohort/retention', cfg)
  return data
}

export async function funnel(cfg: CohortQuery = {}): Promise<FunnelStep[]> {
  const { data } = await client.post<{ steps: FunnelStep[] }>('/cohort/funnel', cfg)
  return data.steps
}
