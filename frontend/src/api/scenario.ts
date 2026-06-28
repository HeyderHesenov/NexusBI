import { client } from './client'

export interface Pacing {
  attainment_pct: number
  elapsed_pct: number
  expected_value: number
  on_track: boolean
  status: string
}

export interface KPITarget {
  id: string
  name: string
  target_value: number
  current_value: number
  period: string
  period_start: string | null
  created_at: string
  pacing: Pacing
}

export interface GoalSeekResult {
  current: number
  total: number
  target: number
  gap: number
  required_pct: number | null
}

export interface MonteCarloBand {
  period: number
  p10: number
  p50: number
  p90: number
}

export interface MonteCarloResult {
  start: number
  mean_return_pct: number
  bands: MonteCarloBand[]
}

export async function listTargets(): Promise<KPITarget[]> {
  const { data } = await client.get<KPITarget[]>('/kpi-targets')
  return data
}

export async function createTarget(payload: {
  name: string
  target_value: number
  current_value: number
  period: string
}): Promise<KPITarget> {
  const { data } = await client.post<KPITarget>('/kpi-targets', payload)
  return data
}

export async function updateTarget(
  id: string,
  payload: Partial<{ name: string; target_value: number; current_value: number; period: string }>,
): Promise<KPITarget> {
  const { data } = await client.patch<KPITarget>(`/kpi-targets/${id}`, payload)
  return data
}

export async function deleteTarget(id: string): Promise<void> {
  await client.delete(`/kpi-targets/${id}`)
}

export async function goalSeek(queryId: string, target: number): Promise<GoalSeekResult> {
  const { data } = await client.post<GoalSeekResult>(`/query/${queryId}/goal-seek`, { target })
  return data
}

export async function monteCarlo(
  queryId: string,
  periods = 6,
  runs = 1000,
): Promise<MonteCarloResult> {
  const { data } = await client.post<MonteCarloResult>(`/query/${queryId}/monte-carlo`, {
    periods,
    runs,
  })
  return data
}
