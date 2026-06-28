import { client } from './client'
import type { AnomalyResult, ExplainResult, ForecastResult, RootCauseResult } from '../types'

export async function detectAnomalies(queryId: string): Promise<AnomalyResult> {
  const { data } = await client.post<AnomalyResult>(`/query/${queryId}/anomalies`)
  return data
}

export async function explain(queryId: string): Promise<ExplainResult> {
  const { data } = await client.post<ExplainResult>(`/query/${queryId}/explain`)
  return data
}

export async function forecast(queryId: string, periods = 6): Promise<ForecastResult> {
  const { data } = await client.post<ForecastResult>(`/query/${queryId}/forecast`, { periods })
  return data
}

export async function rootCause(queryId: string): Promise<RootCauseResult> {
  const { data } = await client.post<RootCauseResult>(`/query/${queryId}/root-cause`)
  return data
}
