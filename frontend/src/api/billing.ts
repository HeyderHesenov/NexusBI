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
