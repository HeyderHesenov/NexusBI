import { client } from './client'
import type { Dashboard, DashboardSummary, Widget } from '../types'

export async function listDashboards(): Promise<DashboardSummary[]> {
  const { data } = await client.get<DashboardSummary[]>('/dashboard/')
  return data
}

export async function createDashboard(
  name: string,
  description = '',
): Promise<Dashboard> {
  const { data } = await client.post<Dashboard>('/dashboard/', { name, description })
  return data
}

export async function getDashboard(id: string): Promise<Dashboard> {
  const { data } = await client.get<Dashboard>(`/dashboard/${id}`)
  return data
}

export async function updateDashboard(
  id: string,
  payload: Partial<Pick<Dashboard, 'name' | 'description' | 'layout'>>,
): Promise<Dashboard> {
  const { data } = await client.put<Dashboard>(`/dashboard/${id}`, payload)
  return data
}

export async function addWidget(
  dashboardId: string,
  payload: { query_log_id: string; title: string },
): Promise<Widget> {
  const { data } = await client.post<Widget>(`/dashboard/${dashboardId}/widget`, payload)
  return data
}

export async function removeWidget(
  dashboardId: string,
  widgetId: string,
): Promise<void> {
  await client.delete(`/dashboard/${dashboardId}/widget/${widgetId}`)
}
