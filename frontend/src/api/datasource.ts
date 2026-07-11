import { client } from './client'
import type { DataSource, DataSourceCreate, DataSourceSchema, PowerBIDataset } from '../types'

export async function list(): Promise<DataSource[]> {
  const { data } = await client.get<DataSource[]>('/datasource/')
  return data
}

export async function create(payload: DataSourceCreate): Promise<DataSource> {
  const { data } = await client.post<DataSource>('/datasource/', payload)
  return data
}

export async function getSchema(id: string): Promise<DataSourceSchema> {
  const { data } = await client.get<DataSourceSchema>(`/datasource/${id}/schema`)
  return data
}

export async function test(id: string): Promise<boolean> {
  const { data } = await client.post<{ ok: boolean }>(`/datasource/${id}/test`)
  return data.ok
}

export async function setSla(id: string, hours: number | null): Promise<DataSource> {
  const { data } = await client.patch<DataSource>(`/datasource/${id}/sla`, {
    freshness_sla_hours: hours,
  })
  return data
}

export interface RLSRule {
  id: string
  datasource_id: string
  member_id: string
  column: string
  allowed_value: string
  created_at: string
}

export async function listRls(id: string): Promise<RLSRule[]> {
  const { data } = await client.get<RLSRule[]>(`/datasource/${id}/rls`)
  return data
}

export async function addRls(
  id: string,
  memberEmail: string,
  column: string,
  allowedValue: string,
): Promise<RLSRule> {
  const { data } = await client.post<RLSRule>(`/datasource/${id}/rls`, {
    member_email: memberEmail,
    column,
    allowed_value: allowedValue,
  })
  return data
}

export async function removeRls(id: string, ruleId: string): Promise<void> {
  await client.delete(`/datasource/${id}/rls/${ruleId}`)
}

export async function remove(id: string): Promise<void> {
  await client.delete(`/datasource/${id}`)
}

export async function upload(file: File, name: string): Promise<DataSource> {
  const form = new FormData()
  form.append('file', file)
  if (name) form.append('name', name)
  const { data } = await client.post<DataSource>('/datasource/upload', form)
  return data
}

export interface DataRefreshResult {
  datasource: DataSource
  rows: number
  /** Raw identifiers (table / table.column) lost vs the previous data. */
  warnings: string[]
}

/** Re-ingest a fresh file into the SAME source id (keeps saved queries/widgets). */
export async function replaceData(id: string, file: File): Promise<DataRefreshResult> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await client.patch<DataRefreshResult>(`/datasource/${id}/data`, form)
  return data
}

export async function listPowerBIDatasets(): Promise<PowerBIDataset[]> {
  const { data } = await client.get<PowerBIDataset[]>('/datasource/powerbi/datasets')
  return data
}

export async function connectPowerBI(name: string, datasetId: string): Promise<DataSource> {
  const { data } = await client.post<DataSource>('/datasource/connect-powerbi', {
    name,
    dataset_id: datasetId,
  })
  return data
}
