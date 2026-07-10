import { client } from './client'
import type { AutoMLTable, MLModelInfo, MLPredictionExplain } from '../types'

export interface PredictResult {
  predictions: unknown[]
  explanations: MLPredictionExplain[][]
}

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
): Promise<PredictResult> {
  const { data } = await client.post<PredictResult>(
    `/automl/models/${modelId}/predict`,
    { rows },
  )
  return { predictions: data.predictions, explanations: data.explanations ?? [] }
}

export async function removeModel(id: string): Promise<void> {
  await client.delete(`/automl/models/${id}`)
}
