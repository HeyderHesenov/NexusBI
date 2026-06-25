import { client } from './client'
import type { AnomalyResult } from '../types'

export async function detectAnomalies(queryId: string): Promise<AnomalyResult> {
  const { data } = await client.post<AnomalyResult>(`/query/${queryId}/anomalies`)
  return data
}
