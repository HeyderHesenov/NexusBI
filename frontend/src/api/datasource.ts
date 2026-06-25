import { client } from './client'
import type { DataSource, DataSourceCreate, DataSourceSchema } from '../types'

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
