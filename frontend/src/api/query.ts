import { client } from './client'
import type { QueryHistoryPage, QueryResult } from '../types'

export async function askQuery(
  nl_query: string,
  datasource_id: string | null,
): Promise<QueryResult> {
  const { data } = await client.post<QueryResult>('/query/ask', {
    nl_query,
    datasource_id,
  })
  return data
}

export async function getHistory(page = 1, limit = 20): Promise<QueryHistoryPage> {
  const { data } = await client.get<QueryHistoryPage>('/query/history', {
    params: { page, limit },
  })
  return data
}

export async function getQuery(id: string): Promise<QueryResult> {
  const { data } = await client.get<QueryResult>(`/query/${id}`)
  return data
}
