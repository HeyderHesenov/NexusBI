import { client } from './client'
import type { GraphData, GraphView, GraphViewCreate, GraphViewUpdate } from '../types'

export async function getGraph(): Promise<GraphData> {
  const { data } = await client.get<GraphData>('/graph/')
  return data
}

// --- Saved views (user-curated overlays over the derived graph) ---

export async function listViews(): Promise<GraphView[]> {
  const { data } = await client.get<GraphView[]>('/graph/views')
  return data
}

export async function createView(payload: GraphViewCreate): Promise<GraphView> {
  const { data } = await client.post<GraphView>('/graph/views', payload)
  return data
}

export async function updateView(id: string, patch: GraphViewUpdate): Promise<GraphView> {
  const { data } = await client.patch<GraphView>(`/graph/views/${id}`, patch)
  return data
}

export async function deleteView(id: string): Promise<void> {
  await client.delete(`/graph/views/${id}`)
}
