import { client } from './client'
import type { Metric, MetricCreate } from '../types'

export async function list(datasourceId?: string | null): Promise<Metric[]> {
  const { data } = await client.get<Metric[]>('/metrics/', {
    params: datasourceId ? { datasource_id: datasourceId } : undefined,
  })
  return data
}

export async function create(payload: MetricCreate): Promise<Metric> {
  const { data } = await client.post<Metric>('/metrics/', payload)
  return data
}

export async function remove(id: string): Promise<void> {
  await client.delete(`/metrics/${id}`)
}
