import { client } from './client'
import type { AutoMLTable, MLModelInfo } from '../types'

export async function tables(): Promise<AutoMLTable[]> {
  const { data } = await client.get<AutoMLTable[]>('/automl/tables')
  return data
}

export async function train(payload: {
  name?: string
  source_table: string
  target_column: string
}): Promise<MLModelInfo> {
  const { data } = await client.post<MLModelInfo>('/automl/train', payload)
  return data
}

export async function listModels(): Promise<MLModelInfo[]> {
  const { data } = await client.get<MLModelInfo[]>('/automl/models')
  return data
}

export async function predict(
  modelId: string,
  rows: Record<string, unknown>[],
): Promise<unknown[]> {
  const { data } = await client.post<{ predictions: unknown[] }>(
    `/automl/models/${modelId}/predict`,
    { rows },
  )
  return data.predictions
}

export async function removeModel(id: string): Promise<void> {
  await client.delete(`/automl/models/${id}`)
}
