import { client } from './client'
import type { DataPrepPreview, DataProfile, DataSource } from '../types'

export async function previewTransform(
  datasourceId: string | null,
  instruction: string,
): Promise<DataPrepPreview> {
  const { data } = await client.post<DataPrepPreview>('/dataprep/preview', {
    datasource_id: datasourceId,
    instruction,
  })
  return data
}

export async function materializeTransform(
  datasourceId: string | null,
  sql: string,
  name: string,
): Promise<DataSource> {
  const { data } = await client.post<DataSource>('/dataprep/materialize', {
    datasource_id: datasourceId,
    sql,
    name,
  })
  return data
}

export async function getProfile(datasourceId: string, table: string): Promise<DataProfile> {
  const { data } = await client.get<DataProfile>(`/datasource/${datasourceId}/profile`, {
    params: { table },
  })
  return data
}
