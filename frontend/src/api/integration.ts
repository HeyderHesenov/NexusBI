import { client } from './client'

export interface IntegrationChannel {
  id: string
  type: string
  name: string
  active: boolean
  created_at: string
}

export async function listChannels(): Promise<IntegrationChannel[]> {
  const { data } = await client.get<IntegrationChannel[]>('/integrations')
  return data
}

export async function createChannel(
  type: string,
  name: string,
  target: string,
): Promise<IntegrationChannel> {
  const { data } = await client.post<IntegrationChannel>('/integrations', { type, name, target })
  return data
}

export async function testChannel(id: string): Promise<boolean> {
  const { data } = await client.post<{ ok: boolean }>(`/integrations/${id}/test`)
  return data.ok
}

export async function deleteChannel(id: string): Promise<void> {
  await client.delete(`/integrations/${id}`)
}
