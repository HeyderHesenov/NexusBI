import { client } from './client'

export interface Channel {
  id: string
  workspace_id: string
  name: string
  created_by: string
  created_at: string
  unread: number
}

export interface ChatMessage {
  id: string
  room_key: string
  author_id: string
  author_name: string
  content: string
  created_at: string
}

export interface DMPeer {
  user_id: string
  email: string
  full_name: string | null
}

export async function listChannels(workspaceId: string): Promise<Channel[]> {
  const { data } = await client.get<Channel[]>(`/workspaces/${workspaceId}/channels`)
  return data
}

export async function createChannel(workspaceId: string, name: string): Promise<Channel> {
  const { data } = await client.post<Channel>(`/workspaces/${workspaceId}/channels`, { name })
  return data
}

export async function history(roomKey: string): Promise<ChatMessage[]> {
  const { data } = await client.get<ChatMessage[]>('/chat/history', {
    params: { room_key: roomKey },
  })
  return data
}

export async function roomTicket(roomKey: string): Promise<string> {
  const { data } = await client.post<{ ticket: string }>('/chat/ticket', { room_key: roomKey })
  return data.ticket
}

export async function markRead(roomKey: string): Promise<void> {
  await client.post('/chat/read', { room_key: roomKey })
}

export async function dmPeers(): Promise<DMPeer[]> {
  const { data } = await client.get<DMPeer[]>('/chat/dm/peers')
  return data
}

// Room-key builders — mirror backend chat_service.channel_room / dm_room.
export function channelRoom(workspaceId: string, channelId: string): string {
  return `ws:${workspaceId}:channel:${channelId}`
}

export function dmRoom(userA: string, userB: string): string {
  const [lo, hi] = [userA, userB].sort()
  return `dm:${lo}:${hi}`
}
