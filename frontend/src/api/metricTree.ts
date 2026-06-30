import { client } from './client'
import type { EvaluatedNode, MetricNode, MetricNodeCreate, TreeOperator } from '../types'

export async function evaluate(): Promise<EvaluatedNode[]> {
  const { data } = await client.get<EvaluatedNode[]>('/metric-tree/evaluate')
  return data
}

export async function create(payload: MetricNodeCreate): Promise<MetricNode> {
  const { data } = await client.post<MetricNode>('/metric-tree/', payload)
  return data
}

export async function update(
  id: string,
  payload: { name?: string; operator?: TreeOperator; manual_value?: number | null },
): Promise<MetricNode> {
  const { data } = await client.patch<MetricNode>(`/metric-tree/${id}`, payload)
  return data
}

export async function remove(id: string): Promise<void> {
  await client.delete(`/metric-tree/${id}`)
}
