import { client } from './client'
import type { EvalRun, ObservabilitySummary } from '../types'

export async function runEval(grounded = false): Promise<EvalRun> {
  const { data } = await client.post<EvalRun>('/ai/eval/run', null, { params: { grounded } })
  return data
}

export async function historyRegression(): Promise<EvalRun> {
  const { data } = await client.post<EvalRun>('/ai/eval/history-regression')
  return data
}

export async function listRuns(): Promise<EvalRun[]> {
  const { data } = await client.get<EvalRun[]>('/ai/eval/runs')
  return data
}

export async function observability(): Promise<ObservabilitySummary> {
  const { data } = await client.get<ObservabilitySummary>('/ai/observability')
  return data
}

export async function reindex(): Promise<{ indexed: number }> {
  const { data } = await client.post<{ indexed: number }>('/ai/retrieval/reindex')
  return data
}
