import { client } from './client'
import type { Plan, Usage } from '../types'

export async function getPlans(): Promise<Plan[]> {
  const { data } = await client.get<Plan[]>('/billing/plans')
  return data
}

export async function getUsage(): Promise<Usage> {
  const { data } = await client.get<Usage>('/billing/usage')
  return data
}

export async function upgrade(tier: string): Promise<Usage> {
  const { data } = await client.post<Usage>('/billing/upgrade', { tier })
  return data
}

export async function checkout(tier: string): Promise<string> {
  const { data } = await client.post<{ checkout_url: string }>('/billing/checkout', { tier })
  return data.checkout_url
}

export async function portal(): Promise<string> {
  const { data } = await client.post<{ portal_url: string }>('/billing/portal')
  return data.portal_url
}
