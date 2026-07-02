import { client } from './client'
import type { GraphData } from '../types'

export async function getGraph(): Promise<GraphData> {
  const { data } = await client.get<GraphData>('/graph/')
  return data
}
