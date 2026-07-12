import { client } from './client'
import type { CopilotAction } from './copilot'

export interface LastMessage {
  author_id: string
  author_name: string
  content: string
  created_at: string
}

export interface Channel {
  id: string
  workspace_id: string
  name: string
  created_by: string
  created_at: string
  unread: number
  last_message?: LastMessage | null
}

export interface AiPlanStep {
  tool: string
  summary: string
}

/** Server-written payload on assistant messages (plan/actions cards). */
export interface AiMeta {
  ai?: boolean
  kind: 'plan' | 'actions' | 'error' | 'reply'
  plan?: AiPlanStep[]
  pending_message?: string
  requester_id?: string
  status?: 'pending' | 'approved' | 'cancelled' | 'failed'
  actions?: CopilotAction[]
}

export interface ChatMessage {
  id: string
  room_key: string
  author_id: string
  author_name: string
  content: string
  created_at: string
  meta?: AiMeta | null
}

export interface DMPeer {
  user_id: string
  email: string
  full_name: string | null
  unread?: number
  last_message?: LastMessage | null
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

export async function approveAi(messageId: string): Promise<void> {
  await client.post('/chat/ai/approve', { message_id: messageId })
}

export async function cancelAi(messageId: string): Promise<void> {
  await client.post('/chat/ai/cancel', { message_id: messageId })
}

// Room-key builders — mirror backend chat_service.channel_room / dm_room / ai_room.
export function channelRoom(workspaceId: string, channelId: string): string {
  return `ws:${workspaceId}:channel:${channelId}`
}

export function dmRoom(userA: string, userB: string): string {
  const [lo, hi] = [userA, userB].sort()
  return `dm:${lo}:${hi}`
}

export function aiRoom(userId: string): string {
  return `ai:${userId}`
}

/** `meta` is written only server-side, so this can't be spoofed by a renamed user. */
export function isAiMessage(m: ChatMessage): boolean {
  return m.meta?.ai === true
}
