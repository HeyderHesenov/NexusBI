import { client } from './client'

export type ReportFormat = 'pdf' | 'xlsx'
export type ReportSchedule = 'hourly' | 'daily' | 'weekly'

export interface Subscription {
  id: string
  saved_query_id: string
  recipient: string
  format: ReportFormat
  schedule: ReportSchedule
  active: boolean
  last_sent_at: string | null
}

export interface SubscriptionCreate {
  recipient: string
  format: ReportFormat
  schedule: ReportSchedule
}

export async function listSubscriptions(savedId: string): Promise<Subscription[]> {
  const { data } = await client.get<Subscription[]>(`/saved/${savedId}/subscriptions`)
  return data
}

export async function createSubscription(
  savedId: string,
  payload: SubscriptionCreate,
): Promise<Subscription> {
  const { data } = await client.post<Subscription>(`/saved/${savedId}/subscriptions`, payload)
  return data
}

export async function deleteSubscription(subId: string): Promise<void> {
  await client.delete(`/saved/subscriptions/${subId}`)
}
