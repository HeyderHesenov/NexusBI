import { client } from './client'
import type { CopilotAction } from './copilot'
import type { WidgetChart } from '../types'

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

export type ShareResourceType =
  | 'query_log'
  | 'dashboard'
  | 'saved_query'
  | 'ml_model'
  | 'ba_artifact'
  | 'decision'
  | 'contract'
  | 'metric'

/** The widget-snapshot shape, minus fields a chat card deliberately omits
 * (sql, natural_language, datasource) — screenshot semantics. */
export type ShareChartPayload = Pick<
  WidgetChart,
  'chart_type' | 'chart_config' | 'columns' | 'data'
> & {
  insight?: string
  /** Server set this when the embedded snapshot dropped rows to fit the card. */
  truncated?: boolean
}

/** Server-built card for an artifact a member shared into the room. */
export interface ShareMeta {
  ai?: never // shares are human messages — keeps isAiMessage() narrowing sound
  kind: 'share'
  resource_type: ShareResourceType
  resource_id: string
  /** The sharer's note, "" when none — content falls back to title then. */
  caption: string
  title: string
  subtitle?: string
  chart?: ShareChartPayload | null
}

export type MessageMeta = AiMeta | ShareMeta

export interface ChatMessage {
  id: string
  room_key: string
  author_id: string
  author_name: string
  content: string
  created_at: string
  meta?: MessageMeta | null
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

export async function shareToChat(payload: {
  room_key: string
  resource_type: ShareResourceType
  resource_id: string
  caption?: string
}): Promise<ChatMessage> {
  const { data } = await client.post<ChatMessage>('/chat/share', payload)
  return data
}

/** A share card's "open" chip navigates exactly like a copilot action chip.
 * Every CopilotAction id field is mechanically `${resource_type}_id`. */
export function shareNavAction(meta: ShareMeta): CopilotAction {
  return {
    type: meta.resource_type,
    label: meta.title,
    [`${meta.resource_type}_id`]: meta.resource_id,
  } as CopilotAction
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
