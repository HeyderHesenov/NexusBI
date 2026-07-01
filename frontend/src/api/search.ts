import { client } from './client'

export interface SearchHit {
  kind: 'dashboard' | 'metric_asset' | 'saved_query'
  ref_id: string
  title: string
  score: number
}

export async function searchAssets(q: string): Promise<SearchHit[]> {
  const { data } = await client.get<SearchHit[]>('/search', { params: { q } })
  return data
}

export async function reindexSearch(): Promise<{ indexed: number }> {
  const { data } = await client.post<{ indexed: number }>('/search/reindex')
  return data
}
