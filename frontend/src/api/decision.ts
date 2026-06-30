import { client } from './client'
import type {
  AccuracySummary,
  Decision,
  DecisionCreate,
  DecisionDirection,
  DecisionMeasurement,
  DecisionROI,
  DecisionStatus,
} from '../types'

export async function list(): Promise<Decision[]> {
  const { data } = await client.get<Decision[]>('/decisions/')
  return data
}

export async function create(payload: DecisionCreate): Promise<Decision> {
  const { data } = await client.post<Decision>('/decisions/', payload)
  return data
}

export async function update(
  id: string,
  patch: {
    title?: string
    action?: string
    status?: DecisionStatus
    outcome?: string
    predicted_value?: number | null
    predicted_direction?: DecisionDirection | null
    measure_cadence?: string
  },
): Promise<Decision> {
  const { data } = await client.put<Decision>(`/decisions/${id}`, patch)
  return data
}

export async function remove(id: string): Promise<void> {
  await client.delete(`/decisions/${id}`)
}

export async function measure(id: string): Promise<DecisionROI> {
  const { data } = await client.post<DecisionROI>(`/decisions/${id}/measure`)
  return data
}

export async function roi(id: string): Promise<DecisionROI> {
  const { data } = await client.get<DecisionROI>(`/decisions/${id}/roi`)
  return data
}

export async function trajectory(id: string): Promise<DecisionMeasurement[]> {
  const { data } = await client.get<DecisionMeasurement[]>(`/decisions/${id}/trajectory`)
  return data
}

export async function accuracy(): Promise<AccuracySummary> {
  const { data } = await client.get<AccuracySummary>('/decisions/accuracy')
  return data
}
