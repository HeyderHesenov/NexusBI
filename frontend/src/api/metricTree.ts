import { client } from './client'
import type {
  BindableSource,
  EvaluatedNode,
  MetricNode,
  MetricNodeCreate,
  MetricNodeUpdate,
} from '../types'

export async function evaluate(): Promise<EvaluatedNode[]> {
  const { data } = await client.get<EvaluatedNode[]>('/metric-tree/evaluate')
  return data
}

/** Saved queries a leaf can measure from, with their last run's columns. */
export async function bindable(): Promise<BindableSource[]> {
  const { data } = await client.get<BindableSource[]>('/metric-tree/bindable')
  return data
}

export async function create(payload: MetricNodeCreate): Promise<MetricNode> {
  const { data } = await client.post<MetricNode>('/metric-tree/', payload)
  return data
}

export async function update(id: string, payload: MetricNodeUpdate): Promise<MetricNode> {
  const { data } = await client.patch<MetricNode>(`/metric-tree/${id}`, payload)
  return data
}

export async function remove(id: string): Promise<void> {
  await client.delete(`/metric-tree/${id}`)
}
